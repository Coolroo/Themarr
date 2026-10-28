// Package prefsapi is the HTTP side of per-user themes (decision 0007,
// docs/contract.md): the signed-in person's theme and saved choice
// (/v1/me/...), and the admins' user and group policies (/v1/policies).
// The server mounts its routes (server.Options.Routes) behind the same
// client-certificate gate as every other route, which is what makes the
// identity headers trustworthy here.
//
// Writes need what admin writes need (server.CheckWrite): themarr's own
// Origin, Sec-Fetch-Site: same-origin, a JSON body, and If-Match with the
// prefs version. Prefs ETags are "p<version>", so a store ETag ("12") can
// never be taken for a prefs version. Each write attempt writes one audit
// line; never a body.
package prefsapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/prefs"
	"github.com/Coolroo/themarr/internal/resolve"
	"github.com/Coolroo/themarr/internal/server"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/strictjson"
	"github.com/Coolroo/themarr/internal/theme"
)

// tagPrefix marks prefs ETags.
const tagPrefix = "p"

// Config is what the routes need.
type Config struct {
	Store        *store.Store
	Prefs        *prefs.Store
	Identity     identity.Source // who is asking; nil: identity.Authelia
	PublicOrigin string          // writes must send this Origin
	AdminGroup   string          // policies need this group
	Manifest     *theme.Manifest // nil: theme.Default()
	Log          *slog.Logger    // audit lines; nil: discard
}

// API serves the routes.
type API struct {
	cfg Config
}

// New builds the routes over cfg.
func New(cfg Config) *API {
	if cfg.Identity == nil {
		cfg.Identity = identity.Authelia{}
	}
	if cfg.Manifest == nil {
		cfg.Manifest = theme.Default()
	}
	if cfg.Log == nil {
		cfg.Log = slog.New(slog.DiscardHandler)
	}
	return &API{cfg: cfg}
}

// Routes are the routes to mount (server.Options.Routes).
func (a *API) Routes() []server.Route {
	rs := []server.Route{
		{Pattern: "GET /v1/me/apps/{app}/theme", Handler: http.HandlerFunc(a.meTheme)},
		{Pattern: "GET /v1/me/apps/{app}/preference", Handler: a.signedIn(a.getPreference)},
		{Pattern: "PUT /v1/me/apps/{app}/preference", Handler: a.signedIn(a.write("put_preference", a.putPreference))},
		{Pattern: "GET /v1/policies", Handler: a.admin(a.listPolicies)},
	}
	for _, s := range []prefs.Scope{prefs.Users, prefs.Groups} {
		path := "/v1/policies/" + string(s) + "/{name}"
		rs = append(rs,
			server.Route{Pattern: "GET " + path, Handler: a.admin(a.getPolicy(s))},
			server.Route{Pattern: "PUT " + path, Handler: a.admin(a.write("put_policy", a.putPolicy(s)))},
			server.Route{Pattern: "DELETE " + path, Handler: a.admin(a.write("delete_policy", a.deletePolicy(s)))},
		)
	}
	return rs
}

// handler is a route's handler, given the caller's identity.
type handler func(w http.ResponseWriter, r *http.Request, who identity.Identity)

// signedIn refuses a caller without an identity (401).
func (a *API) signedIn(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := a.cfg.Identity.Identify(r)
		if !ok {
			server.Problem(w, r, http.StatusUnauthorized, "unauthenticated", "Sign in first.")
			return
		}
		h(w, r, who)
	}
}

// admin refuses a caller without an identity (401) or outside the admin
// group (403).
func (a *API) admin(h handler) http.HandlerFunc {
	return a.signedIn(func(w http.ResponseWriter, r *http.Request, who identity.Identity) {
		if !who.InGroup(a.cfg.AdminGroup) {
			server.Problem(w, r, http.StatusForbidden, "not_admin", "Only admins may use this route.")
			return
		}
		h(w, r, who)
	})
}

// writeHandler is a write, given the prefs version the caller read.
type writeHandler func(w http.ResponseWriter, r *http.Request, who identity.Identity, expected uint64)

// recorder notes the status and problem code of an answer, for the audit
// line (server.ProblemRecorder).
type recorder struct {
	http.ResponseWriter
	status int
	code   string
}

func (r *recorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) RecordProblem(code string) { r.code = code }

// write checks what every write needs (server.CheckWrite, with the prefs
// version) and writes one audit line for the attempt: who, what, the
// target, the result. Never the body.
func (a *API) write(action string, h writeHandler) handler {
	return func(w http.ResponseWriter, r *http.Request, who identity.Identity) {
		rec := &recorder{ResponseWriter: w}
		defer func() {
			status := rec.status
			if status == 0 {
				status = http.StatusOK
			}
			result := "ok"
			if status >= 400 {
				result = "refused"
				if status >= 500 {
					result = "failed"
				}
			}
			a.cfg.Log.Info("write", slog.String("request_id", server.RequestID(r)), slog.String("user", who.User),
				slog.String("action", action), slog.String("target", target(r)), slog.Int("status", status),
				slog.String("result", result), slog.String("code", rec.code),
				slog.Uint64("prefs_version", a.cfg.Prefs.Snapshot().Version))
		}()
		expected, ok := server.CheckWrite(rec, r, a.cfg.PublicOrigin, tagPrefix)
		if !ok {
			return
		}
		h(rec, r, who, expected)
	}
}

// target names what a write changes: the app ("board") or the policy
// ("groups/family").
func target(r *http.Request) string {
	if app := r.PathValue("app"); app != "" {
		return app
	}
	scope := prefs.Users
	if strings.HasPrefix(r.URL.Path, "/v1/policies/groups/") {
		scope = prefs.Groups
	}
	return string(scope) + "/" + r.PathValue("name")
}

func prefsTag(v uint64) string { return `"` + tagPrefix + strconv.FormatUint(v, 10) + `"` }

var (
	errLocked   = errors.New("locked")
	errNotFound = errors.New("not found")
)

// updated answers a prefs update's outcome; false after a refusal.
func (a *API) updated(w http.ResponseWriter, r *http.Request, err error) bool {
	var rule *store.RuleError
	switch {
	case err == nil:
		return true
	case errors.Is(err, prefs.ErrConflict):
		server.Problem(w, r, http.StatusPreconditionFailed, "version_conflict", "The preferences changed since you read them; read them again.")
	case errors.Is(err, errLocked):
		server.Problem(w, r, http.StatusConflict, "locked", "An admin has set this theme for you; it can't be changed.")
	case errors.Is(err, errNotFound):
		server.Problem(w, r, http.StatusNotFound, "not_found", "No such policy.")
	case errors.As(err, &rule):
		server.Problem(w, r, http.StatusUnprocessableEntity, rule.Code, rule.Detail)
	default:
		a.cfg.Log.Error("prefs write failed", slog.String("request_id", server.RequestID(r)), slog.String("error", err.Error()))
		server.Problem(w, r, http.StatusInternalServerError, "store_failed", "The change could not be saved.")
	}
	return false
}

// --- /v1/me ---

// meTheme serves GET|HEAD /v1/me/apps/{app}/theme: the theme this person
// gets in this app (200), or nothing (204). Credentialed CORS only for
// the app's registered origins.
func (a *API) meTheme(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Cache-Control", "private, no-cache")
	h.Add("Vary", "Origin")
	app := r.PathValue("app")
	if !a.cfg.Manifest.ValidID(app) {
		server.Problem(w, r, http.StatusNotFound, "not_found", "No such app.")
		return
	}
	d := a.cfg.Store.Snapshot()
	allowOrigin(w, r, d, app)
	who, ok := a.cfg.Identity.Identify(r)
	if !ok {
		server.Problem(w, r, http.StatusUnauthorized, "unauthenticated", "Sign in first.")
		return
	}
	res := resolve.Resolve(resolve.Input{Data: d, Prefs: a.cfg.Prefs.Snapshot(), Who: &who, App: app})
	if res.Theme == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tag := meTag(res, d.Version)
	h.Set("ETag", tag)
	if server.NoneMatch(r, tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Method == http.MethodHead {
		h.Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		return
	}
	server.WriteJSON(w, http.StatusOK, meBody{Public: res.Theme.Public(), Locked: res.Locked, Source: string(res.Source)})
}

// meBody is the public view of the theme, and where it came from.
type meBody struct {
	theme.Public
	Locked bool   `json:"locked"`
	Source string `json:"source"`
}

// allowOrigin sets credentialed CORS when the request's one Origin is one
// of the registered app's origins; otherwise it sets nothing.
func allowOrigin(w http.ResponseWriter, r *http.Request, d *store.Data, app string) {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 {
		return
	}
	for _, o := range d.Apps[app].Origins {
		if o == origins[0] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", o)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Expose-Headers", "ETag, X-Request-Id")
			return
		}
	}
}

// meTag is a strong tag for one answer: the theme at this store version,
// its source and the lock.
func meTag(res resolve.Resolution, storeVersion uint64) string {
	sum := sha256.Sum256([]byte("me\x00" + res.Theme.ID + "\x00" + strconv.FormatInt(res.Theme.Version, 10) + "\x00" +
		strconv.FormatUint(storeVersion, 10) + "\x00" + string(res.Source) + "\x00" + strconv.FormatBool(res.Locked)))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

// preference is the body of the preference routes.
type preference struct {
	App    string  `json:"app"`
	Theme  *string `json:"theme"`
	Locked bool    `json:"locked"`
}

// registeredApp refuses an app that is not registered (404).
func registeredApp(w http.ResponseWriter, r *http.Request, d *store.Data) (string, bool) {
	app := r.PathValue("app")
	if _, ok := d.Apps[app]; !ok {
		server.Problem(w, r, http.StatusNotFound, "not_found", "No such app.")
		return "", false
	}
	return app, true
}

func preferenceOf(d *store.Data, p *prefs.Data, who identity.Identity, app string) preference {
	out := preference{App: app}
	if t, ok := p.Choice(who.User, app); ok {
		out.Theme = &t
	}
	_, out.Locked = resolve.Enforced(resolve.Input{Data: d, Prefs: p, Who: &who, App: app})
	return out
}

// getPreference serves GET /v1/me/apps/{app}/preference: the saved choice
// (or null) and whether an admin locks this app's theme for this person.
func (a *API) getPreference(w http.ResponseWriter, r *http.Request, who identity.Identity) {
	d := a.cfg.Store.Snapshot()
	app, ok := registeredApp(w, r, d)
	if !ok {
		return
	}
	p := a.cfg.Prefs.Snapshot()
	w.Header().Set("ETag", prefsTag(p.Version))
	server.WriteJSON(w, http.StatusOK, preferenceOf(d, p, who, app))
}

var preferenceFields = map[string][]string{"": {"theme"}}

// putPreference saves (a theme id) or clears (null) the person's choice.
// Setting a theme while an admin enforces one is 409 locked; clearing is
// always allowed.
func (a *API) putPreference(w http.ResponseWriter, r *http.Request, who identity.Identity, expected uint64) {
	d := a.cfg.Store.Snapshot()
	app, ok := registeredApp(w, r, d)
	if !ok {
		return
	}
	body, ok := server.ReadJSON(w, r)
	if !ok {
		return
	}
	var in struct {
		Theme *string `json:"theme"`
	}
	if err := strictjson.Decode(body, &in, preferenceFields); err != nil {
		server.Problem(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if !hasKeys(body, "theme") {
		server.Problem(w, r, http.StatusUnprocessableEntity, "missing_field", "Send theme, a theme id or null.")
		return
	}
	if in.Theme != nil && d.Themes[*in.Theme] == nil {
		server.Problem(w, r, http.StatusUnprocessableEntity, "unknown_theme", "No such theme.")
		return
	}
	p, err := a.cfg.Prefs.Update(expected, func(p *prefs.Data) error {
		if in.Theme == nil {
			p.SetChoice(who.User, app, "")
			return nil
		}
		if _, locked := resolve.Enforced(resolve.Input{Data: d, Prefs: p, Who: &who, App: app}); locked {
			return errLocked
		}
		p.SetChoice(who.User, app, *in.Theme)
		return nil
	})
	if !a.updated(w, r, err) {
		return
	}
	w.Header().Set("ETag", prefsTag(p.Version))
	server.WriteJSON(w, http.StatusOK, preferenceOf(d, p, who, app))
}

// --- /v1/policies ---

func (a *API) listPolicies(w http.ResponseWriter, r *http.Request, _ identity.Identity) {
	p := a.cfg.Prefs.Snapshot()
	w.Header().Set("ETag", prefsTag(p.Version))
	server.WriteJSON(w, http.StatusOK, map[string]any{"users": p.Users, "groups": p.Groups})
}

func (a *API) getPolicy(s prefs.Scope) handler {
	return func(w http.ResponseWriter, r *http.Request, _ identity.Identity) {
		p := a.cfg.Prefs.Snapshot()
		pol, ok := p.Policies(s)[r.PathValue("name")]
		if !ok {
			server.Problem(w, r, http.StatusNotFound, "not_found", "No such policy.")
			return
		}
		w.Header().Set("ETag", prefsTag(p.Version))
		server.WriteJSON(w, http.StatusOK, pol)
	}
}

var policyFields = map[string][]string{"": {"theme", "kind"}}

// putPolicy creates or replaces the policy for one user or group, for
// every app.
func (a *API) putPolicy(s prefs.Scope) writeHandler {
	return func(w http.ResponseWriter, r *http.Request, _ identity.Identity, expected uint64) {
		name := r.PathValue("name")
		if !identity.ValidName(name) {
			server.Problem(w, r, http.StatusUnprocessableEntity, "bad_name", "A name is 1-128 of A-Za-z0-9 . _ @ -.")
			return
		}
		body, ok := server.ReadJSON(w, r)
		if !ok {
			return
		}
		var pol prefs.Policy
		if err := strictjson.Decode(body, &pol, policyFields); err != nil {
			server.Problem(w, r, http.StatusBadRequest, "invalid_json", err.Error())
			return
		}
		if !hasKeys(body, "theme", "kind") {
			server.Problem(w, r, http.StatusUnprocessableEntity, "missing_field", "Send theme (a theme id) and kind.")
			return
		}
		if !pol.Kind.Valid() {
			server.Problem(w, r, http.StatusUnprocessableEntity, "invalid", `kind must be "default" or "enforced".`)
			return
		}
		if a.cfg.Store.Snapshot().Themes[pol.Theme] == nil {
			server.Problem(w, r, http.StatusUnprocessableEntity, "unknown_theme", "No such theme.")
			return
		}
		created := false
		p, err := a.cfg.Prefs.Update(expected, func(p *prefs.Data) error {
			_, exists := p.Policies(s)[name]
			created = !exists
			p.SetPolicy(s, name, pol)
			return nil
		})
		if !a.updated(w, r, err) {
			return
		}
		w.Header().Set("ETag", prefsTag(p.Version))
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		server.WriteJSON(w, status, pol)
	}
}

func (a *API) deletePolicy(s prefs.Scope) writeHandler {
	return func(w http.ResponseWriter, r *http.Request, _ identity.Identity, expected uint64) {
		if !server.NoBody(w, r) {
			return
		}
		name := r.PathValue("name")
		p, err := a.cfg.Prefs.Update(expected, func(p *prefs.Data) error {
			if !p.DeletePolicy(s, name) {
				return errNotFound
			}
			return nil
		})
		if !a.updated(w, r, err) {
			return
		}
		w.Header().Set("ETag", prefsTag(p.Version))
		w.WriteHeader(http.StatusNoContent)
	}
}

// hasKeys reports whether the top object of a body (already checked by
// strictjson) has every key named.
func hasKeys(body []byte, keys ...string) bool {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		return false
	}
	for _, k := range keys {
		if _, ok := top[k]; !ok {
			return false
		}
	}
	return true
}
