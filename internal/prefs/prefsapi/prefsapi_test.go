package prefsapi

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Coolroo/themarr/internal/prefs"
	"github.com/Coolroo/themarr/internal/resolve"
	"github.com/Coolroo/themarr/internal/server"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
	"github.com/Coolroo/themarr/internal/theme/themetest"
)

const (
	origin = "https://themarr.test"
	gw     = "tls-gateway"
)

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

type harness struct {
	t     *testing.T
	store *store.Store
	prefs *prefs.Store
	h     http.Handler
	audit *syncBuffer
	dir   string
}

// newHarness: themes ocean, forest and night; apps board and seerr, each
// with its own origin; the global default ocean. Wired like main.go, but
// with a save limit no test reaches unless an edit sets one.
func newHarness(t *testing.T, edit ...func(*Config)) *harness {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir, theme.Default())
	if err != nil {
		t.Fatal(err)
	}
	pr, err := prefs.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	hs := &harness{t: t, store: st, prefs: pr, audit: &syncBuffer{}, dir: dir}
	cfg := Config{Store: st, Prefs: pr, PublicOrigin: origin, AdminGroup: "admins",
		Log: slog.New(slog.NewJSONHandler(hs.audit, nil)), SaveBurst: 1000}
	for _, e := range edit {
		e(&cfg)
	}
	api := New(cfg)
	srv := server.New(st, server.Options{ClientCN: gw, PublicOrigin: origin, AdminGroup: "admins",
		Resolver: func(d *store.Data, app string) server.Resolution {
			r := resolve.Public(d, app)
			return server.Resolution{Theme: r.Theme, From: string(r.Source)}
		},
		Routes: api.Routes(), ThemeInUse: pr.ThemeInUse})
	hs.h = srv.Handler()
	if _, err := st.Update(0, func(d *store.Data) error {
		for _, id := range []string{"ocean", "forest", "night"} {
			th, err := theme.Default().Parse(themetest.JSON(themetest.Valid(id)))
			if err != nil {
				return err
			}
			d.Themes[id] = th
		}
		for _, id := range []string{"board", "seerr"} {
			d.Apps[id] = store.App{ID: id, Name: id, Origins: []string{"https://" + id + ".test", "https://" + id + "2.test"}}
		}
		g := "ocean"
		d.Assignments.Global = &g
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return hs
}

func req(method, path, body string, headers ...string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	r.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{{Subject: pkix.Name{CommonName: gw}}}}}
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Add(headers[i], headers[i+1])
	}
	return r
}

func (hs *harness) do(method, path, body string, headers ...string) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	hs.h.ServeHTTP(rr, req(method, path, body, headers...))
	return rr
}

func user(name string, groups ...string) []string {
	return []string{"Remote-User", name, "Remote-Groups", strings.Join(groups, ",")}
}

var admin = user("root", "users", "admins")

// writeAs: the headers a write needs, as who, at If-Match tag.
func writeAs(who []string, tag string) []string {
	return append(append([]string{}, who...), "Origin", origin, "Sec-Fetch-Site", "same-origin",
		"Content-Type", "application/json", "If-Match", tag)
}

func (hs *harness) tag() string { return prefsTag(hs.prefs.Snapshot().Version) }

func (hs *harness) mustDo(method, path, body string, headers ...string) *httptest.ResponseRecorder {
	hs.t.Helper()
	rr := hs.do(method, path, body, headers...)
	if rr.Code >= 300 {
		hs.t.Fatalf("%s %s: %d %s", method, path, rr.Code, rr.Body.String())
	}
	return rr
}

func (hs *harness) policy(scope, name, themeID, kind string) {
	hs.t.Helper()
	hs.mustDo(http.MethodPut, "/v1/policies/"+scope+"/"+name, `{"theme":"`+themeID+`","kind":"`+kind+`"}`, writeAs(admin, hs.tag())...)
}

func (hs *harness) choose(who []string, app, themeID string) {
	hs.t.Helper()
	hs.mustDo(http.MethodPut, "/v1/me/apps/"+app+"/preference", `{"theme":"`+themeID+`"}`, writeAs(who, hs.tag())...)
}

func problem(t *testing.T, rr *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rr.Code != status {
		t.Fatalf("status %d, want %d: %s", rr.Code, status, rr.Body.String())
	}
	var p map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil || p["code"] != code {
		t.Fatalf("problem %s, want %s", rr.Body.String(), code)
	}
}

func decode(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &m); err != nil {
		t.Fatalf("%v: %s", err, rr.Body.String())
	}
	return m
}

// me fetches /v1/me/apps/{app}/theme and returns the source, the lock and
// the theme's version, or "" for 204.
func (hs *harness) me(who []string, app string) (string, bool) {
	hs.t.Helper()
	rr := hs.do(http.MethodGet, "/v1/me/apps/"+app+"/theme", "", who...)
	if rr.Code == http.StatusNoContent {
		return "", false
	}
	if rr.Code != http.StatusOK {
		hs.t.Fatalf("me: %d %s", rr.Code, rr.Body.String())
	}
	m := decode(hs.t, rr)
	return m["source"].(string), m["locked"].(bool)
}

func TestMeThemeNeedsIdentity(t *testing.T) {
	hs := newHarness(t)
	problem(t, hs.do(http.MethodGet, "/v1/me/apps/board/theme", ""), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", "Remote-User", "a", "Remote-User", "b"), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", "Remote-User", "bad user"), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/me/apps/Board/theme", "", user("alice")...), http.StatusNotFound, "not_found")
	// Behind the same gate as every route.
	r := req(http.MethodGet, "/v1/me/apps/board/theme", "", user("alice")...)
	r.TLS.VerifiedChains[0][0].Subject.CommonName = "npm-homepi"
	rr := httptest.NewRecorder()
	hs.h.ServeHTTP(rr, r)
	problem(t, rr, http.StatusForbidden, "client_not_allowed")
	r = req(http.MethodGet, "/v1/policies", "", admin...)
	r.TLS.VerifiedChains[0][0].Subject.CommonName = "enforcarr"
	rr = httptest.NewRecorder()
	hs.h.ServeHTTP(rr, r)
	problem(t, rr, http.StatusForbidden, "client_not_allowed")
}

// TestMeThemeLayers walks the layers through the route, top down.
func TestMeThemeLayers(t *testing.T) {
	hs := newHarness(t)
	alice := user("alice", "family")
	hs.choose(alice, "board", "forest")
	hs.policy("users", "alice", "night", "enforced")
	if src, locked := hs.me(alice, "board"); src != "enforced" || !locked {
		t.Fatalf("enforced: %s %v", src, locked)
	}
	hs.mustDo(http.MethodDelete, "/v1/policies/users/alice", "", writeAs(admin, hs.tag())...)
	if src, locked := hs.me(alice, "board"); src != "saved" || locked {
		t.Fatalf("saved: %s %v", src, locked)
	}
	hs.policy("groups", "family", "night", "default")
	if src, _ := hs.me(alice, "board"); src != "saved" {
		t.Fatalf("saved beats default: %s", src)
	}
	if src, _ := hs.me(alice, "seerr"); src != "default" {
		t.Fatalf("default: %s", src)
	}
	if src, _ := hs.me(user("bob"), "seerr"); src != "global" {
		t.Fatalf("global: %s", src)
	}
	if _, err := hs.store.Update(hs.store.Snapshot().Version, func(d *store.Data) error {
		d.Assignments.PerApp["seerr"] = "forest"
		d.Assignments.PerApp["board"] = store.None
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if src, _ := hs.me(user("bob"), "seerr"); src != "app" {
		t.Fatalf("app: %s", src)
	}
	if src, _ := hs.me(user("bob"), "board"); src != "" {
		t.Fatalf("none: %s", src)
	}
	// An enforced group policy beats the person's saved choice.
	hs.policy("groups", "family", "night", "enforced")
	if src, locked := hs.me(alice, "board"); src != "enforced" || !locked {
		t.Fatalf("group enforced: %s %v", src, locked)
	}
}

func TestMeThemeBody(t *testing.T) {
	hs := newHarness(t)
	rr := hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", user("alice")...)
	m := decode(t, rr)
	keys := []string{}
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if !reflect.DeepEqual(keys, []string{"locked", "modes", "source", "tokens", "version"}) {
		t.Fatalf("keys %v", keys)
	}
	if m["source"] != "global" || m["locked"] != false || rr.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%v", m)
	}
	if cc := rr.Header().Get("Cache-Control"); cc != "private, no-cache" {
		t.Fatalf("cache-control %q", cc)
	}
	if rr.Header().Get("Vary") != "Origin" {
		t.Fatalf("vary %q", rr.Header().Get("Vary"))
	}
}

func TestMeThemeETag(t *testing.T) {
	hs := newHarness(t)
	alice := user("alice")
	rr := hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", alice...)
	tag := rr.Header().Get("ETag")
	if rr.Code != 200 || tag == "" {
		t.Fatalf("%d %q", rr.Code, tag)
	}
	if rr := hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", append(alice, "If-None-Match", tag)...); rr.Code != http.StatusNotModified || rr.Body.Len() != 0 {
		t.Fatalf("304: %d", rr.Code)
	}
	head := hs.do(http.MethodHead, "/v1/me/apps/board/theme", "", alice...)
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("ETag") != tag {
		t.Fatalf("HEAD: %d %d", head.Code, head.Body.Len())
	}
	// The same theme, now enforced: another tag (the body says locked).
	hs.policy("users", "alice", "ocean", "enforced")
	rr = hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", append(alice, "If-None-Match", tag)...)
	if rr.Code != 200 || rr.Header().Get("ETag") == tag {
		t.Fatalf("enforced: %d %q", rr.Code, rr.Header().Get("ETag"))
	}
	// The public route's tag is another one too.
	if pub := hs.do(http.MethodGet, "/v1/apps/board/theme", ""); pub.Header().Get("ETag") == tag {
		t.Fatal("the personal and public answers share a tag")
	}
}

// TestMeThemeCORS: credentialed CORS only for one of the requested app's
// registered origins, on every answer of the route; nothing otherwise.
func TestMeThemeCORS(t *testing.T) {
	hs := newHarness(t)
	alice := user("alice")
	for _, o := range []string{"https://board.test", "https://board2.test"} {
		for name, rr := range map[string]*httptest.ResponseRecorder{
			"200": hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", append(alice, "Origin", o)...),
			"401": hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", "Origin", o),
		} {
			h := rr.Header()
			if h.Get("Access-Control-Allow-Origin") != o || h.Get("Access-Control-Allow-Credentials") != "true" ||
				h.Get("Vary") != "Origin" || !strings.Contains(h.Get("Access-Control-Expose-Headers"), "ETag") {
				t.Errorf("%s %s: %v", o, name, h)
			}
		}
	}
	for name, headers := range map[string][]string{
		"no origin":        alice,
		"other app":        append(alice, "Origin", "https://seerr.test"),
		"themarr":          append(alice, "Origin", origin),
		"stranger":         append(alice, "Origin", "https://evil.test"),
		"suffix":           append(alice, "Origin", "https://board.test.evil.test"),
		"upper case":       append(alice, "Origin", "https://BOARD.test"),
		"trailing slash":   append(alice, "Origin", "https://board.test/"),
		"null":             append(alice, "Origin", "null"),
		"two origins":      append(alice, "Origin", "https://board.test", "Origin", "https://board.test"),
		"http":             append(alice, "Origin", "http://board.test"),
		"unregistered app": append(alice, "Origin", "https://other.test"),
	} {
		path := "/v1/me/apps/board/theme"
		if name == "unregistered app" {
			path = "/v1/me/apps/other/theme"
		}
		rr := hs.do(http.MethodGet, path, "", headers...)
		h := rr.Header()
		if h.Get("Access-Control-Allow-Origin") != "" || h.Get("Access-Control-Allow-Credentials") != "" {
			t.Errorf("%s: CORS %v", name, h)
		}
		if h.Get("Vary") != "Origin" {
			t.Errorf("%s: no Vary", name)
		}
	}
	// Never on the other new routes (same-origin only).
	for _, path := range []string{"/v1/me/apps/board/preference", "/v1/policies"} {
		rr := hs.do(http.MethodGet, path, "", append(append([]string{}, admin...), "Origin", "https://board.test")...)
		if rr.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("%s: CORS", path)
		}
	}
}

func TestMeThemeNothingIs204(t *testing.T) {
	hs := newHarness(t)
	if _, err := hs.store.Update(hs.store.Snapshot().Version, func(d *store.Data) error { d.Assignments.Global = nil; return nil }); err != nil {
		t.Fatal(err)
	}
	rr := hs.do(http.MethodGet, "/v1/me/apps/board/theme", "", append(user("alice"), "Origin", "https://board.test")...)
	if rr.Code != http.StatusNoContent || rr.Body.Len() != 0 || rr.Header().Get("ETag") != "" ||
		rr.Header().Get("Access-Control-Allow-Origin") != "https://board.test" {
		t.Fatalf("%d %v", rr.Code, rr.Header())
	}
}

// TestPublicRouteIgnoresPolicies: the public route reads no identity, so
// no policy or choice reaches it.
func TestPublicRouteIgnoresPolicies(t *testing.T) {
	hs := newHarness(t)
	before := hs.do(http.MethodGet, "/v1/apps/board/theme", "").Body.String()
	hs.policy("users", "alice", "night", "enforced")
	hs.choose(user("bob"), "board", "forest")
	for _, who := range [][]string{nil, user("alice"), user("bob")} {
		if got := hs.do(http.MethodGet, "/v1/apps/board/theme", "", who...).Body.String(); got != before {
			t.Fatalf("%v changed the public answer", who)
		}
	}
}

func TestPreferenceRoutes(t *testing.T) {
	hs := newHarness(t)
	alice := user("alice")
	rr := hs.do(http.MethodGet, "/v1/me/apps/board/preference", "", alice...)
	if rr.Code != 200 || rr.Header().Get("ETag") != `"p0"` || rr.Body.String() != `{"app":"board","theme":null,"locked":false}`+"\n" {
		t.Fatalf("%d %q %s", rr.Code, rr.Header().Get("ETag"), rr.Body.String())
	}
	problem(t, hs.do(http.MethodGet, "/v1/me/apps/board/preference", ""), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/me/apps/other/preference", "", alice...), http.StatusNotFound, "not_found")
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/other/preference", `{"theme":"ocean"}`, writeAs(alice, `"p0"`)...), http.StatusNotFound, "not_found")
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"gone"}`, writeAs(alice, `"p0"`)...), http.StatusUnprocessableEntity, "unknown_theme")
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{}`, writeAs(alice, `"p0"`)...), http.StatusUnprocessableEntity, "missing_field")
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"ocean","x":1}`, writeAs(alice, `"p0"`)...), http.StatusBadRequest, "invalid_json")
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"Theme":"ocean"}`, writeAs(alice, `"p0"`)...), http.StatusBadRequest, "invalid_json")
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"ocean"}`, writeAs(nil, `"p0"`)...), http.StatusUnauthorized, "unauthenticated")

	rr = hs.mustDo(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"forest"}`, writeAs(alice, `"p0"`)...)
	if rr.Code != 200 || rr.Header().Get("ETag") != `"p1"` || rr.Body.String() != `{"app":"board","theme":"forest","locked":false}`+"\n" {
		t.Fatalf("%d %q %s", rr.Code, rr.Header().Get("ETag"), rr.Body.String())
	}
	// The choice is the caller's own, for that app only.
	if c, _ := hs.prefs.Snapshot().Choice("alice", "board"); c != "forest" {
		t.Fatal(c)
	}
	if src, _ := hs.me(user("bob"), "board"); src != "global" {
		t.Fatal("another user got alice's choice")
	}
	// A stale version.
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"night"}`, writeAs(alice, `"p0"`)...), http.StatusPreconditionFailed, "version_conflict")
	// Clear.
	rr = hs.mustDo(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":null}`, writeAs(alice, `"p1"`)...)
	if !strings.Contains(rr.Body.String(), `"theme":null`) || len(hs.prefs.Snapshot().Choices) != 0 {
		t.Fatal(rr.Body.String())
	}
}

// TestLockedPreference: while an admin enforces a theme for the person,
// setting a choice is 409 locked; clearing is still allowed.
func TestLockedPreference(t *testing.T) {
	hs := newHarness(t)
	alice := user("alice", "kids")
	hs.choose(alice, "board", "forest")
	hs.policy("groups", "kids", "night", "enforced")
	rr := hs.do(http.MethodGet, "/v1/me/apps/board/preference", "", alice...)
	if !strings.Contains(rr.Body.String(), `"locked":true`) {
		t.Fatal(rr.Body.String())
	}
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"ocean"}`, writeAs(alice, hs.tag())...), http.StatusConflict, "locked")
	hs.mustDo(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":null}`, writeAs(alice, hs.tag())...)
	// A default policy doesn't lock.
	hs.policy("groups", "kids", "night", "default")
	hs.choose(alice, "board", "ocean")
	// Neither does an enforced policy naming a deleted theme.
	if _, err := hs.prefs.Update(hs.prefs.Snapshot().Version, func(p *prefs.Data) error {
		p.SetPolicy(prefs.Groups, "kids", prefs.Policy{Theme: "gone", Kind: prefs.Enforced})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	hs.choose(alice, "board", "forest")
	if src, locked := hs.me(alice, "board"); src != "saved" || locked {
		t.Fatalf("%s %v", src, locked)
	}
}

// TestWriteChecks: each check a write needs refuses on its own, on the
// preference route and on the policy routes, and changes nothing.
func TestWriteChecks(t *testing.T) {
	hs := newHarness(t)
	for _, w := range []struct{ method, path, body string }{
		{http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"ocean"}`},
		{http.MethodPut, "/v1/policies/users/bob", `{"theme":"ocean","kind":"default"}`},
		{http.MethodPut, "/v1/policies/groups/family", `{"theme":"ocean","kind":"default"}`},
	} {
		good := writeAs(admin, `"p0"`)
		set := func(name, value string) []string {
			out := []string{}
			for i := 0; i < len(good); i += 2 {
				if good[i] != name {
					out = append(out, good[i], good[i+1])
				}
			}
			if value != "" {
				out = append(out, name, value)
			}
			return out
		}
		for _, c := range []struct {
			headers []string
			status  int
			code    string
		}{
			{set("Origin", ""), 403, "bad_origin"},
			{set("Origin", "https://board.test"), 403, "bad_origin"},
			{append(set("Origin", origin), "Origin", origin), 403, "bad_origin"},
			{set("Sec-Fetch-Site", ""), 403, "cross_site"},
			{set("Sec-Fetch-Site", "same-site"), 403, "cross_site"},
			{set("If-Match", ""), 428, "if_match_required"},
			{set("If-Match", `"0"`), 400, "bad_if_match"}, // a store tag
			{set("If-Match", `*`), 400, "bad_if_match"},
			{set("If-Match", `W/"p0"`), 400, "bad_if_match"},
			{set("If-Match", `"p"`), 400, "bad_if_match"},
			{set("If-Match", `"p7"`), 412, "version_conflict"},
			{set("Content-Type", ""), 415, "unsupported_media_type"},
			{set("Content-Type", "text/plain"), 415, "unsupported_media_type"},
		} {
			problem(t, hs.do(w.method, w.path, w.body, c.headers...), c.status, c.code)
		}
		if hs.prefs.Snapshot().Version != 0 {
			t.Fatalf("%s: a refused write changed the prefs", w.path)
		}
		problem(t, hs.do(w.method, w.path, strings.Repeat(" ", 33<<10)+"{}", good...), http.StatusRequestEntityTooLarge, "too_large")
	}
}

func TestPolicyRoutes(t *testing.T) {
	hs := newHarness(t)
	// Admins only.
	problem(t, hs.do(http.MethodGet, "/v1/policies", ""), http.StatusUnauthorized, "unauthenticated")
	for _, route := range []string{"GET /v1/policies", "GET /v1/policies/users/x", "PUT /v1/policies/users/x", "DELETE /v1/policies/users/x",
		"GET /v1/policies/groups/x", "PUT /v1/policies/groups/x", "DELETE /v1/policies/groups/x"} {
		method, path, _ := strings.Cut(route, " ")
		problem(t, hs.do(method, path, `{"theme":"ocean","kind":"default"}`, writeAs(user("bob", "users", "admins-x"), `"p0"`)...), http.StatusForbidden, "not_admin")
	}
	rr := hs.do(http.MethodGet, "/v1/policies", "", admin...)
	if rr.Code != 200 || rr.Header().Get("ETag") != `"p0"` || rr.Body.String() != `{"groups":{},"users":{}}`+"\n" {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	put := func(path, body string) *httptest.ResponseRecorder {
		return hs.do(http.MethodPut, path, body, writeAs(admin, hs.tag())...)
	}
	problem(t, put("/v1/policies/users/bob", `{"theme":"gone","kind":"default"}`), 422, "unknown_theme")
	problem(t, put("/v1/policies/users/bob", `{"theme":"ocean","kind":"always"}`), 422, "invalid")
	problem(t, put("/v1/policies/users/bob", `{"theme":"ocean"}`), 422, "missing_field")
	problem(t, put("/v1/policies/users/bob", `{"theme":"ocean","kind":"default","x":1}`), 400, "invalid_json")
	problem(t, put("/v1/policies/users/b+b", `{"theme":"ocean","kind":"default"}`), 422, "bad_name")
	// An escaped name never reaches the route (T-115: escaped paths are 404).
	problem(t, put("/v1/policies/users/b%20b", `{"theme":"ocean","kind":"default"}`), 404, "not_found")
	problem(t, put("/v1/policies/groups/"+strings.Repeat("g", 129), `{"theme":"ocean","kind":"default"}`), 422, "bad_name")

	if rr := put("/v1/policies/users/bob", `{"theme":"ocean","kind":"default"}`); rr.Code != 201 || rr.Header().Get("ETag") != `"p1"` {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	if rr := put("/v1/policies/users/bob", `{"theme":"night","kind":"enforced"}`); rr.Code != 200 || rr.Body.String() != `{"theme":"night","kind":"enforced"}`+"\n" {
		t.Fatalf("replace: %d %s", rr.Code, rr.Body.String())
	}
	if rr := put("/v1/policies/groups/bob", `{"theme":"forest","kind":"default"}`); rr.Code != 201 {
		t.Fatalf("group: %d", rr.Code)
	}
	rr = hs.do(http.MethodGet, "/v1/policies/users/bob", "", admin...)
	if rr.Code != 200 || rr.Body.String() != `{"theme":"night","kind":"enforced"}`+"\n" || rr.Header().Get("ETag") != `"p3"` {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	m := decode(t, hs.do(http.MethodGet, "/v1/policies", "", admin...))
	if len(m["users"].(map[string]any)) != 1 || len(m["groups"].(map[string]any)) != 1 {
		t.Fatalf("%v", m)
	}
	problem(t, hs.do(http.MethodGet, "/v1/policies/users/nobody", "", admin...), 404, "not_found")
	problem(t, hs.do(http.MethodGet, "/v1/policies/teams/bob", "", admin...), 404, "not_found")
	// Delete.
	problem(t, hs.do(http.MethodDelete, "/v1/policies/users/bob", "x", writeAs(admin, hs.tag())...), 400, "unexpected_body")
	if rr := hs.do(http.MethodDelete, "/v1/policies/users/bob", "", writeAs(admin, hs.tag())...); rr.Code != 204 || rr.Header().Get("ETag") != `"p4"` {
		t.Fatalf("delete: %d", rr.Code)
	}
	problem(t, hs.do(http.MethodDelete, "/v1/policies/users/bob", "", writeAs(admin, hs.tag())...), 404, "not_found")
	if _, ok := hs.prefs.Snapshot().Groups["bob"]; !ok {
		t.Fatal("deleting the user policy took the group policy")
	}
}

// TestThemeDeleteInUse: the admin delete of a theme a policy names is 409;
// a saved choice doesn't block it, and is skipped afterwards.
func TestThemeDeleteInUse(t *testing.T) {
	hs := newHarness(t)
	hs.policy("groups", "family", "night", "default")
	hs.choose(user("alice"), "board", "forest")
	del := func(id string) *httptest.ResponseRecorder {
		v := hs.store.Snapshot().Version
		return hs.do(http.MethodDelete, "/v1/themes/"+id, "", writeAs(admin, `"`+itoa(v)+`"`)...)
	}
	problem(t, del("night"), http.StatusConflict, "in_use")
	hs.mustDo(http.MethodDelete, "/v1/policies/groups/family", "", writeAs(admin, hs.tag())...)
	if rr := del("night"); rr.Code != 204 {
		t.Fatalf("after the policy went: %d %s", rr.Code, rr.Body.String())
	}
	if rr := del("forest"); rr.Code != 204 {
		t.Fatalf("a saved choice blocked the delete: %d", rr.Code)
	}
	if src, _ := hs.me(user("alice"), "board"); src != "global" {
		t.Fatalf("the deleted saved theme: %s", src)
	}
	rr := hs.do(http.MethodGet, "/v1/me/apps/board/preference", "", user("alice")...)
	if !strings.Contains(rr.Body.String(), `"theme":"forest"`) {
		t.Fatal(rr.Body.String())
	}
}

func itoa(v uint64) string { b, _ := json.Marshal(v); return string(b) }

// TestAuditLines: one line per write attempt, refused or not: who, what,
// the target, the result. Never the body.
func TestAuditLines(t *testing.T) {
	hs := newHarness(t)
	hs.choose(user("alice"), "board", "forest")
	problem(t, hs.do(http.MethodPut, "/v1/policies/groups/family", `{"theme":"night","kind":"enforced"}`, writeAs(admin, `"p9"`)...), 412, "version_conflict")
	hs.do(http.MethodGet, "/v1/policies", "", admin...) // reads are not audited
	lines := strings.Split(strings.TrimSpace(hs.audit.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("%d lines: %s", len(lines), hs.audit.String())
	}
	want := []map[string]any{
		{"user": "alice", "action": "put_preference", "target": "board", "status": float64(200), "result": "ok", "code": "", "prefs_version": float64(1)},
		{"user": "root", "action": "put_policy", "target": "groups/family", "status": float64(412), "result": "refused", "code": "version_conflict", "prefs_version": float64(1)},
	}
	for i, l := range lines {
		var m map[string]any
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			t.Fatal(err)
		}
		for k, v := range want[i] {
			if m[k] != v {
				t.Errorf("line %d: %s = %v, want %v", i, k, m[k], v)
			}
		}
		if m["request_id"] == "" || strings.Contains(l, "forest") || strings.Contains(l, "night") {
			t.Errorf("line %d: %s", i, l)
		}
	}
}

// TestConcurrentPreferenceWrites: of many tabs of one person sending the
// same version, exactly one wins and the rest get 412; many people sending
// that version all win, since each saves only their own choice.
func TestConcurrentPreferenceWrites(t *testing.T) {
	hs := newHarness(t)
	const n = 12
	run := func(who func(i int) []string, pick func(i int) string) []int {
		var wg sync.WaitGroup
		codes := make([]int, n)
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				codes[i] = hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"`+pick(i)+`"}`, writeAs(who(i), `"p0"`)...).Code
			}(i)
		}
		wg.Wait()
		return codes
	}
	themes := []string{"forest", "night", "ocean"}
	codes := run(func(int) []string { return user("alice") }, func(i int) string { return themes[i%3] })
	ok := 0
	for _, c := range codes {
		switch c {
		case 200:
			ok++
		case 412:
		default:
			t.Fatalf("code %d", c)
		}
	}
	if ok != 1 || hs.prefs.Snapshot().Version != 1 {
		t.Fatalf("one person: %d won, version %d", ok, hs.prefs.Snapshot().Version)
	}
	codes = run(func(i int) []string { return user("user" + itoa(uint64(i))) }, func(int) string { return "forest" })
	for _, c := range codes {
		if c != 200 {
			t.Fatalf("many people: code %d", c)
		}
	}
	if v := hs.prefs.Snapshot().Version; v != n+1 {
		t.Fatalf("version %d", v)
	}
}

// TestNoOpSaveWritesNothing (T-115 review): saving the choice a person
// already has is answered like a read: 200, the same body and ETag, no
// new version and no write to the file.
func TestNoOpSaveWritesNothing(t *testing.T) {
	hs := newHarness(t)
	bob := user("bob", "users")
	hs.choose(bob, "board", "forest")
	path := filepath.Join(hs.dir, prefs.FileName)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	read := hs.do(http.MethodGet, "/v1/me/apps/board/preference", "", bob...)
	for i := 0; i < 50; i++ {
		rr := hs.mustDo(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"forest"}`, writeAs(bob, `"p1"`)...)
		if rr.Code != 200 || rr.Header().Get("ETag") != read.Header().Get("ETag") || rr.Body.String() != read.Body.String() {
			t.Fatalf("%d %q %s", rr.Code, rr.Header().Get("ETag"), rr.Body.String())
		}
	}
	// Clearing a choice nobody saved changes nothing either.
	hs.mustDo(http.MethodPut, "/v1/me/apps/seerr/preference", `{"theme":null}`, writeAs(bob, `"p1"`)...)
	if after, _ := os.ReadFile(path); string(after) != string(before) {
		t.Fatal("a no-op save changed the file")
	}
	if fi, err := os.Stat(path); err != nil || !fi.ModTime().Equal(old) {
		t.Fatal("a no-op save rewrote the file")
	}
	// Nor does an admin saving a policy as it is.
	hs.policy("users", "carol", "night", "default")
	if rr := hs.do(http.MethodPut, "/v1/policies/users/carol", `{"theme":"night","kind":"default"}`, writeAs(admin, `"p2"`)...); rr.Code != 200 || rr.Header().Get("ETag") != `"p2"` {
		t.Fatalf("policy as it is: %d %q", rr.Code, rr.Header().Get("ETag"))
	}
	if v := hs.prefs.Snapshot().Version; v != 2 {
		t.Fatalf("version %d after no-op saves", v)
	}
	if strings.Count(hs.audit.String(), `"result":"unchanged"`) != 52 {
		t.Fatalf("audit: %s", hs.audit.String())
	}
}

// TestSavesDontStarveOthers (T-115 review): a person's saves, even many,
// never make an admin's policy write or another person's save fail with
// 412; a stale tag still conflicts on the part it names.
func TestSavesDontStarveOthers(t *testing.T) {
	hs := newHarness(t)
	bob, alice := user("bob", "users"), user("alice", "users")
	adminRead := hs.tag()
	aliceRead := hs.tag()
	for i := 0; i < 20; i++ {
		th := []string{"forest", "night"}[i%2]
		hs.mustDo(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"`+th+`"}`, writeAs(bob, hs.tag())...)
	}
	if rr := hs.do(http.MethodPut, "/v1/policies/users/carol", `{"theme":"night","kind":"enforced"}`, writeAs(admin, adminRead)...); rr.Code != 201 {
		t.Fatalf("admin after bob's saves: %d %s", rr.Code, rr.Body.String())
	}
	if rr := hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"ocean"}`, writeAs(alice, aliceRead)...); rr.Code != 200 {
		t.Fatalf("alice after bob's saves: %d %s", rr.Code, rr.Body.String())
	}
	// Another admin's write still makes the first admin's tag stale.
	problem(t, hs.do(http.MethodPut, "/v1/policies/users/dave", `{"theme":"night","kind":"default"}`, writeAs(admin, adminRead)...), 412, "version_conflict")
	// And bob's own stale tag still conflicts with his own last save.
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"ocean"}`, writeAs(bob, aliceRead)...), 412, "version_conflict")
	// A tag newer than the file is never right.
	problem(t, hs.do(http.MethodPut, "/v1/me/apps/seerr/preference", `{"theme":"ocean"}`, writeAs(bob, `"p999"`)...), 412, "version_conflict")
}

// TestSaveRateLimit (T-115 review): each person may save a burst, then a
// few times a second; beyond that 429 rate_limited with Retry-After. Other
// people are not affected.
func TestSaveRateLimit(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	hs := newHarness(t, func(c *Config) {
		c.SaveBurst, c.SaveRate = 3, 0.5
		c.Now = func() time.Time { return now }
	})
	bob := user("bob")
	save := func(who []string) *httptest.ResponseRecorder {
		return hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"forest"}`, writeAs(who, hs.tag())...)
	}
	for i := 0; i < 3; i++ {
		if rr := save(bob); rr.Code != 200 {
			t.Fatalf("save %d: %d", i, rr.Code)
		}
	}
	rr := save(bob)
	problem(t, rr, http.StatusTooManyRequests, "rate_limited")
	if ra := rr.Header().Get("Retry-After"); ra != "2" {
		t.Fatalf("Retry-After %q", ra)
	}
	if rr := save(user("alice")); rr.Code != 200 {
		t.Fatalf("another person: %d", rr.Code)
	}
	now = now.Add(2 * time.Second)
	if rr := save(bob); rr.Code != 200 {
		t.Fatalf("after waiting: %d", rr.Code)
	}
	problem(t, save(bob), http.StatusTooManyRequests, "rate_limited")
}

// TestQuietAuditLinesAreCapped (T-115 review): a signed-in person
// repeating refused or unchanged writes can't flood the log; writes that
// change something are always logged.
func TestQuietAuditLinesAreCapped(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	hs := newHarness(t, func(c *Config) { c.Now = func() time.Time { return now } })
	bob := user("bob")
	hs.choose(bob, "board", "forest")
	for i := 0; i < 2*server.LogLinesPerMinute; i++ {
		hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"forest"}`, writeAs(bob, `"p1"`)...)
		hs.do(http.MethodPut, "/v1/me/apps/board/preference", `{"theme":"night"}`, writeAs(bob, `"x"`)...)
	}
	if n := strings.Count(hs.audit.String(), `"msg":"write"`); n != 1+server.LogLinesPerMinute {
		t.Fatalf("%d audit lines", n)
	}
	hs.choose(bob, "board", "night")
	if n := strings.Count(hs.audit.String(), `"result":"ok"`); n != 2 {
		t.Fatalf("%d ok lines", n)
	}
}
