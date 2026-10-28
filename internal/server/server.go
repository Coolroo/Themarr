// Package server is themarr's HTTP API (docs/contract.md). Every request on
// the TLS listener passes the same gate first: Go has verified a client
// certificate against the home CA, and its common name must be the one
// configured (tls-gateway). Then:
//
//   - public routes (an app's theme, a theme's tokens, the catalog) answer
//     anyone, read no identity headers, and hold colours and theme names
//     only (decisions 0004, 0009);
//   - admin routes need Remote-User and the admin group in Remote-Groups,
//     which are trusted only because the CN pin proves the request came
//     through tls-gateway, behind Authelia;
//   - admin writes also need themarr's own Origin, Sec-Fetch-Site:
//     same-origin, a JSON body and If-Match with the store version.
package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
	"github.com/Coolroo/themarr/internal/tlsutil"
)

// Resolution is the theme an app gets, and where it came from.
type Resolution struct {
	Theme *theme.Theme // nil: no theme, the app keeps its own defaults
	From  string       // "app", "global" or "" (none)
}

// Resolver picks the theme an app gets on the public route, from one store
// snapshot. It is the seam for layered resolution (T-089): main.go may
// pass another one; DefaultResolver is the app's assignment, then the
// global default, then nothing.
type Resolver func(d *store.Data, app string) Resolution

// DefaultResolver: the app's own assignment (a theme or "none"), else the
// global default, else nothing. An app that is not registered is treated
// as one with no assignment, so it gets the global default too: the
// answer never tells a registered app from an unknown one.
func DefaultResolver(d *store.Data, app string) Resolution {
	if v, ok := d.Assignments.PerApp[app]; ok && v != store.Inherit {
		if v == store.None {
			return Resolution{}
		}
		if t := d.Themes[v]; t != nil {
			return Resolution{Theme: t, From: "app"}
		}
		return Resolution{}
	}
	if g := d.Assignments.Global; g != nil {
		if t := d.Themes[*g]; t != nil {
			return Resolution{Theme: t, From: "global"}
		}
	}
	return Resolution{}
}

// Identity is who sent a request (internal/identity).
type Identity = identity.Identity

// Identify reads the caller's identity from a request on the trusted hop.
// ok is false when the request carries no usable identity. It is the seam
// for identity modules (internal/identity: a Source's Identify method);
// the default is RemoteHeaders.
type Identify func(r *http.Request) (id Identity, ok bool)

// Route is an extra route mounted behind the same gate and headers, for
// packages that add routes (T-089: /v1/me/...). Pattern is a Go 1.22 mux
// pattern, such as "GET /v1/me/apps/{app}/theme".
type Route struct {
	Pattern string
	Handler http.Handler
}

// Options configure the server.
type Options struct {
	ClientCN     string // the client certificate CN let in
	PublicOrigin string // admin writes must send this Origin
	AdminGroup   string // the group that makes a user an admin
	Manifest     *theme.Manifest
	Resolver     Resolver     // nil: DefaultResolver
	Identify     Identify     // nil: RemoteHeaders
	Routes       []Route      // extra routes
	UI           http.Handler // the admin UI at /; nil serves nothing there
	Drawer       http.Handler // the drawer page at /drawer (decision 0009); nil: 404
	Log          *slog.Logger // nil: discard
	Now          func() time.Time

	// ThemeInUse reports whether something outside the store (a user or
	// group policy, internal/prefs) names a theme; deleting such a theme
	// is refused with 409 in_use. nil: nothing outside the store does.
	ThemeInUse func(id string) bool

	// AppDeleted is called after an app is deleted (the new snapshot is
	// published), so what is kept outside the store for it (saved
	// choices, internal/prefs) goes too. nil: nothing.
	AppDeleted func(id string)
}

// Server holds what a request needs.
type Server struct {
	opt    Options
	store  *store.Store
	checks *checks
	log    *slog.Logger
	cache  atomic.Pointer[publicCache] // the newest snapshot's public answers

	// Caps on log lines anybody behind the gate can cause (T-115).
	refusedClients *LogCap // wrong client certificate CN
	refusedWrites  *LogCap // refused admin writes' audit lines
}

// New builds the server over st.
func New(st *store.Store, o Options) *Server {
	if o.Resolver == nil {
		o.Resolver = DefaultResolver
	}
	if o.Identify == nil {
		o.Identify = RemoteHeaders
	}
	if o.Manifest == nil {
		o.Manifest = theme.Default()
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	log := o.Log
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	registered := func(app string) bool { _, ok := st.Snapshot().Apps[app]; return ok }
	return &Server{opt: o, store: st, checks: newChecks(registered), log: log,
		refusedClients: NewLogCap("client refused", LogLinesPerMinute, o.Now),
		refusedWrites:  NewLogCap("write refused", LogLinesPerMinute, o.Now)}
}

// Handler returns every route, behind the client-certificate gate.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	// Public: no identity, colours only, CORS for any origin.
	mux.Handle("GET /v1/apps/{app}/theme", public(http.HandlerFunc(s.appTheme)))
	mux.Handle("GET /v1/themes/{id}/tokens", public(http.HandlerFunc(s.themeTokens)))
	mux.Handle("GET /v1/catalog", public(http.HandlerFunc(s.catalog)))

	// The drawer page: the one answer that may be framed (drawer.go).
	mux.HandleFunc("GET "+DrawerPath, s.drawerPage)

	// Admin reads.
	mux.HandleFunc("GET /v1/themes", s.admin(s.listThemes))
	mux.HandleFunc("GET /v1/themes/{id}", s.admin(s.getTheme))
	mux.HandleFunc("GET /v1/apps", s.admin(s.listApps))
	mux.HandleFunc("GET /v1/apps/{id}", s.admin(s.getApp))
	mux.HandleFunc("GET /v1/apps/{id}/last-check", s.admin(s.lastCheck))
	mux.HandleFunc("GET /v1/assignments", s.admin(s.getAssignments))
	mux.HandleFunc("GET /v1/favourites", s.admin(s.getFavourites))

	// Admin writes.
	mux.HandleFunc("PUT /v1/themes/{id}", s.admin(s.write("put_theme", s.putTheme)))
	mux.HandleFunc("DELETE /v1/themes/{id}", s.admin(s.write("delete_theme", s.deleteTheme)))
	mux.HandleFunc("PUT /v1/apps/{id}", s.admin(s.write("put_app", s.putApp)))
	mux.HandleFunc("DELETE /v1/apps/{id}", s.admin(s.write("delete_app", s.deleteApp)))
	mux.HandleFunc("PUT /v1/assignments", s.admin(s.write("put_assignments", s.putAssignments)))
	mux.HandleFunc("PUT /v1/favourites", s.admin(s.write("put_favourites", s.putFavourites)))

	for _, rt := range s.opt.Routes {
		mux.Handle(rt.Pattern, rt.Handler)
	}

	// Anything else under /v1 is a JSON 404 (an unknown route or method).
	mux.HandleFunc("/v1/", func(w http.ResponseWriter, r *http.Request) {
		Problem(w, r, http.StatusNotFound, "not_found", "No such endpoint.")
	})
	// The admin UI everywhere else. ("GET /" would conflict with "/v1/" in
	// the mux, so the method is checked here.)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if s.opt.UI != nil && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			s.opt.UI.ServeHTTP(w, r)
			return
		}
		Problem(w, r, http.StatusNotFound, "not_found", "No such endpoint.")
	})
	return withRequestID(withHeaders(s.requireClient(mux)))
}

// requireClient lets in only the configured client certificate CN, read
// from the chain Go verified. A connection without a verified client
// certificate never gets this far (the TLS handshake refuses it); this
// refuses the home CA's other clients (npm-homepi, enforcarr, ...).
func (s *Server) requireClient(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cn, ok := tlsutil.VerifiedCN(r.TLS)
		if !ok || cn != s.opt.ClientCN {
			s.refusedClients.Log(s.log, slog.LevelWarn, "client refused", slog.String("request_id", RequestID(r)), slog.String("cn", cn))
			Problem(w, r, http.StatusForbidden, "client_not_allowed", "This client certificate may not call themarr.")
			return
		}
		if !plainPath(r) {
			Problem(w, r, http.StatusNotFound, "not_found", "No such endpoint.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// plainPath refuses a path with a percent-escape. Go routes an escaped
// slash inside one segment (/v1/apps/board%2Ftheme is the app
// "board/theme", an admin route), while NPM and Authelia match the
// decoded, cleaned path (/v1/apps/board/theme, the public bypass), and
// %3F, %5C, %2E and %25 can make them disagree the same way. No themarr
// route or page needs an escape in its path, so a path with one, or with
// a character Go would have escaped (RawPath is then set), is 404 before
// routing (T-115).
func plainPath(r *http.Request) bool {
	return r.URL.RawPath == "" && !strings.Contains(r.URL.EscapedPath(), "%")
}

// ProblemRecorder is a ResponseWriter that notes the problem code of an
// answer, for an audit line. ProblemWith tells it the code.
type ProblemRecorder interface {
	http.ResponseWriter
	RecordProblem(code string)
}

// Problem writes an RFC 9457 problem: a stable code and the request id.
func Problem(w http.ResponseWriter, r *http.Request, status int, code, detail string) {
	ProblemWith(w, r, status, code, detail, nil)
}

// ProblemWith is Problem with extra members (such as a theme's issues).
func ProblemWith(w http.ResponseWriter, r *http.Request, status int, code, detail string, extra map[string]any) {
	if rec, ok := w.(ProblemRecorder); ok {
		rec.RecordProblem(code)
	}
	body := map[string]any{}
	for k, v := range extra {
		body[k] = v
	}
	body["type"] = "about:blank"
	body["title"] = http.StatusText(status)
	body["status"] = status
	body["code"] = code
	body["detail"] = detail
	body["request_id"] = RequestID(r)
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Del("ETag")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

// WriteJSON writes v as JSON with status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

type ctxKey struct{}

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 8)
		rand.Read(b)
		id := hex.EncodeToString(b)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
	})
}

// RequestID is the id withRequestID gave this request.
func RequestID(r *http.Request) string {
	id, _ := r.Context().Value(ctxKey{}).(string)
	return id
}

// apiCSP is the policy for everything but the UI: nothing loads, nothing
// frames.
const apiCSP = "default-src 'none'; frame-ancestors 'none'"

// withHeaders sets the defaults every answer gets; public routes and the UI
// change Cache-Control and the CSP for themselves.
func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", apiCSP)
		if !frameable(r) {
			h.Set("X-Frame-Options", "DENY")
		}
		next.ServeHTTP(w, r)
	})
}
