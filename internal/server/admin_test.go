package server

import (
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/Coolroo/themarr/internal/theme/themetest"
)

func TestGate(t *testing.T) {
	hs := newHarness(t)
	for name, r := range map[string]*http.Request{
		"no TLS": func() *http.Request { r := req(http.MethodGet, "/v1/apps/a/theme", ""); r.TLS = nil; return r }(),
		"other CN": func() *http.Request {
			r := req(http.MethodGet, "/v1/apps/a/theme", "")
			r.TLS = tlsState("npm-homepi")
			return r
		}(),
		"unverified": func() *http.Request {
			r := req(http.MethodGet, "/v1/apps/a/theme", "")
			r.TLS.PeerCertificates = r.TLS.VerifiedChains[0]
			r.TLS.VerifiedChains = nil
			return r
		}(),
		"other CN admin": func() *http.Request {
			r := req(http.MethodGet, "/v1/themes", "", adminHeaders...)
			r.TLS = tlsState("enforcarr")
			return r
		}(),
		"other CN ui": func() *http.Request { r := req(http.MethodGet, "/", ""); r.TLS = tlsState("x"); return r }(),
	} {
		problem(t, hs.serve(r), http.StatusForbidden, "client_not_allowed")
		_ = name
	}
	if rr := hs.do(http.MethodGet, "/v1/apps/a/theme", ""); rr.Code != http.StatusNoContent {
		t.Fatalf("tls-gateway: %d", rr.Code)
	}
}

func TestCommonHeaders(t *testing.T) {
	hs := newHarness(t)
	for _, path := range []string{"/v1/themes", "/v1/apps/a/theme", "/v1/nothing", "/"} {
		rr := hs.do(http.MethodGet, path, "", adminHeaders...)
		h := rr.Header()
		if len(h.Get("X-Request-Id")) != 16 || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("X-Frame-Options") != "DENY" ||
			h.Get("Content-Security-Policy") == "" {
			t.Errorf("%s: headers %v", path, h)
		}
	}
	if rr := hs.admin(http.MethodGet, "/v1/themes"); rr.Header().Get("Cache-Control") != "no-store" ||
		!strings.Contains(rr.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("admin headers %v", rr.Header())
	}
	// A request id from the client is not echoed.
	if rr := hs.do(http.MethodGet, "/v1/apps/a/theme", "", "X-Request-Id", "mine"); rr.Header().Get("X-Request-Id") == "mine" {
		t.Fatal("the client's request id was used")
	}
}

func TestUIAndUnknownRoutes(t *testing.T) {
	hs := newHarness(t)
	rr := hs.do(http.MethodGet, "/themes/ocean", "")
	if rr.Code != 200 || rr.Body.String() != "<html>ui</html>" || rr.Header().Get("Content-Security-Policy") != "ui-policy" {
		t.Fatalf("ui: %d %q", rr.Code, rr.Body.String())
	}
	problem(t, hs.do(http.MethodPost, "/", "x"), http.StatusNotFound, "not_found")
	problem(t, hs.admin(http.MethodGet, "/v1/nothing"), http.StatusNotFound, "not_found")
	problem(t, hs.do(http.MethodPost, "/v1/themes", "{}", writeHeaders(0)...), http.StatusNotFound, "not_found")
}

func TestAdminNeedsIdentityAndGroup(t *testing.T) {
	hs := newHarness(t)
	problem(t, hs.do(http.MethodGet, "/v1/themes", ""), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/themes", "", "Remote-Groups", "admins"), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/themes", "", "Remote-User", "bad user"), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/themes", "", "Remote-User", "a", "Remote-User", "b", "Remote-Groups", "admins"), http.StatusUnauthorized, "unauthenticated")
	problem(t, hs.do(http.MethodGet, "/v1/themes", "", "Remote-User", "a", "Remote-Groups", "users", "Remote-Groups", "admins"), http.StatusUnauthorized, "unauthenticated")
	for _, groups := range []string{"", "users", "admins-x,users", "Admins", "users;admins"} {
		problem(t, hs.do(http.MethodGet, "/v1/themes", "", "Remote-User", "bob", "Remote-Groups", groups), http.StatusForbidden, "not_admin")
	}
	for _, groups := range []string{"admins", "users, admins", " admins ,x"} {
		if rr := hs.do(http.MethodGet, "/v1/themes", "", "Remote-User", "alice", "Remote-Groups", groups); rr.Code != 200 {
			t.Errorf("groups %q: %d", groups, rr.Code)
		}
	}
	// Every admin route checks.
	for _, route := range []string{"GET /v1/themes/x", "GET /v1/apps", "GET /v1/apps/x", "GET /v1/assignments", "GET /v1/favourites",
		"GET /v1/apps/x/last-check", "PUT /v1/themes/x", "DELETE /v1/themes/x", "PUT /v1/apps/x", "DELETE /v1/apps/x",
		"PUT /v1/assignments", "PUT /v1/favourites"} {
		method, path, _ := strings.Cut(route, " ")
		problem(t, hs.do(method, path, "{}", "Remote-User", "bob", "Remote-Groups", "users", "Origin", origin,
			"Sec-Fetch-Site", "same-origin", "Content-Type", "application/json", "If-Match", `"0"`), http.StatusForbidden, "not_admin")
	}
}

// without returns writeHeaders(v) without header name (and its value).
func without(v uint64, name string) []string {
	h := writeHeaders(v)
	out := []string{}
	for i := 0; i < len(h); i += 2 {
		if h[i] != name {
			out = append(out, h[i], h[i+1])
		}
	}
	return out
}

func with(v uint64, name, value string) []string {
	return append(without(v, name), name, value)
}

// TestWriteChecks: each check a write needs refuses on its own, and a
// refused write changes nothing.
func TestWriteChecks(t *testing.T) {
	hs := newHarness(t)
	body := `{"id":"board","name":"Board","origins":[]}`
	cases := []struct {
		name    string
		headers []string
		status  int
		code    string
	}{
		{"no Origin", without(0, "Origin"), 403, "bad_origin"},
		{"other Origin", with(0, "Origin", "https://evil.test"), 403, "bad_origin"},
		{"Origin with slash", with(0, "Origin", origin+"/"), 403, "bad_origin"},
		{"two Origins", append(writeHeaders(0), "Origin", origin), 403, "bad_origin"},
		{"no Sec-Fetch-Site", without(0, "Sec-Fetch-Site"), 403, "cross_site"},
		{"same-site", with(0, "Sec-Fetch-Site", "same-site"), 403, "cross_site"},
		{"cross-site", with(0, "Sec-Fetch-Site", "cross-site"), 403, "cross_site"},
		{"no If-Match", without(0, "If-Match"), 428, "if_match_required"},
		{"If-Match star", with(0, "If-Match", "*"), 400, "bad_if_match"},
		{"weak If-Match", with(0, "If-Match", `W/"0"`), 400, "bad_if_match"},
		{"bare If-Match", with(0, "If-Match", "0"), 400, "bad_if_match"},
		{"two If-Match", append(writeHeaders(0), "If-Match", `"0"`), 400, "bad_if_match"},
		{"stale If-Match", with(0, "If-Match", `"5"`), 412, "version_conflict"},
		{"no Content-Type", without(0, "Content-Type"), 415, "unsupported_media_type"},
		{"text/plain", with(0, "Content-Type", "text/plain"), 415, "unsupported_media_type"},
		{"json with other charset", with(0, "Content-Type", "application/json; charset=latin1"), 415, "unsupported_media_type"},
		{"json-ish", with(0, "Content-Type", "application/jsonx"), 415, "unsupported_media_type"},
	}
	for _, c := range cases {
		rr := hs.do(http.MethodPut, "/v1/apps/board", body, c.headers...)
		if rr.Code != c.status || !strings.Contains(rr.Body.String(), `"code":"`+c.code+`"`) {
			t.Errorf("%s: %d %s", c.name, rr.Code, rr.Body.String())
		}
	}
	if d := hs.store.Snapshot(); d.Version != 0 || len(d.Apps) != 0 {
		t.Fatal("a refused write changed the store")
	}
	if rr := hs.do(http.MethodPut, "/v1/apps/board", body, with(0, "Content-Type", "application/json; charset=UTF-8")...); rr.Code != 201 {
		t.Fatalf("charset utf-8: %d %s", rr.Code, rr.Body.String())
	}
}

func TestStaleWriteAfterAnotherWrite(t *testing.T) {
	hs := newHarness(t)
	hs.putApp("board")
	read := hs.admin(http.MethodGet, "/v1/apps/board")
	tag := read.Header().Get("ETag")
	if tag != `"1"` {
		t.Fatalf("tag %q", tag)
	}
	hs.putApp("other")
	rr := hs.do(http.MethodPut, "/v1/apps/board", `{"id":"board","name":"New","origins":[]}`, with(0, "If-Match", tag)...)
	problem(t, rr, http.StatusPreconditionFailed, "version_conflict")
}

// TestConcurrentWrites: of two writes sent with the same If-Match, one
// lands and the other gets 412.
func TestConcurrentWrites(t *testing.T) {
	hs := newHarness(t)
	const n = 8
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := "app-" + string(rune('a'+i))
			codes[i] = hs.do(http.MethodPut, "/v1/apps/"+id, `{"id":"`+id+`","name":"A","origins":[]}`, writeHeaders(0)...).Code
		}(i)
	}
	wg.Wait()
	ok, conflict := 0, 0
	for _, c := range codes {
		switch c {
		case 201:
			ok++
		case 412:
			conflict++
		}
	}
	if ok != 1 || conflict != n-1 {
		t.Fatalf("codes %v", codes)
	}
}

func TestPutTheme(t *testing.T) {
	hs := newHarness(t)
	doc := themetest.Valid("ocean")
	rr := hs.mustWrite(http.MethodPut, "/v1/themes/ocean", string(themetest.JSON(doc)))
	if rr.Code != 201 || rr.Header().Get("ETag") != `"1"` || decode(t, rr)["version"] != float64(1) {
		t.Fatalf("create: %d %v", rr.Code, rr.Header())
	}
	doc["version"] = 7 // the server owns the version
	rr = hs.mustWrite(http.MethodPut, "/v1/themes/ocean", string(themetest.JSON(doc)))
	if rr.Code != 200 || decode(t, rr)["version"] != float64(2) || rr.Header().Get("ETag") != `"2"` {
		t.Fatalf("replace: %d %s", rr.Code, rr.Body.String())
	}
	got := decode(t, hs.admin(http.MethodGet, "/v1/themes/ocean"))
	if got["name"] != "Theme ocean" || got["source"].(map[string]any)["kind"] != "handmade" {
		t.Fatalf("read back %v", got)
	}
	list := decode(t, hs.admin(http.MethodGet, "/v1/themes"))
	if len(list["themes"].([]any)) != 1 {
		t.Fatalf("list %v", list)
	}
	problem(t, hs.admin(http.MethodGet, "/v1/themes/missing"), http.StatusNotFound, "not_found")
}

func TestPutThemeRefuses(t *testing.T) {
	hs := newHarness(t)
	bad := themetest.Valid("ocean")
	delete(bad["tokens"].(map[string]any)["dark"].(map[string]any), "primary")
	p := problem(t, hs.write(http.MethodPut, "/v1/themes/ocean", string(themetest.JSON(bad))), 422, "invalid_theme")
	issues := p["issues"].([]any)
	if len(issues) != 1 || issues[0].(map[string]any)["code"] != "missing_token" || issues[0].(map[string]any)["path"] != "/tokens/dark/primary" {
		t.Fatalf("issues %v", issues)
	}
	problem(t, hs.write(http.MethodPut, "/v1/themes/ocean", `{"id":"ocean","id":"x"}`), 400, "invalid_json")
	problem(t, hs.write(http.MethodPut, "/v1/themes/ocean", `not json`), 400, "invalid_json")
	problem(t, hs.write(http.MethodPut, "/v1/themes/sea", string(themetest.JSON(themetest.Valid("ocean")))), 422, "id_mismatch")
	problem(t, hs.write(http.MethodPut, "/v1/themes/none", string(themetest.JSON(themetest.Valid("none")))), 422, "bad_id")
	big := `{"id":"` + strings.Repeat("a", maxThemeBody) + `"}`
	problem(t, hs.write(http.MethodPut, "/v1/themes/ocean", big), 413, "too_large")
	if hs.store.Snapshot().Version != 0 {
		t.Fatal("a refused theme changed the store")
	}
}

func TestDeleteTheme(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.putTheme("paper")
	hs.putApp("board")
	hs.mustWrite(http.MethodPut, "/v1/favourites", `{"favourites":["ocean","paper"]}`)
	hs.assign("ocean", map[string]string{"board": "paper"})
	problem(t, hs.write(http.MethodDelete, "/v1/themes/ocean", ""), http.StatusConflict, "in_use")
	problem(t, hs.write(http.MethodDelete, "/v1/themes/paper", ""), http.StatusConflict, "in_use")
	problem(t, hs.write(http.MethodDelete, "/v1/themes/missing", ""), http.StatusNotFound, "not_found")
	problem(t, hs.write(http.MethodDelete, "/v1/themes/ocean", "{}"), http.StatusBadRequest, "unexpected_body")
	hs.assign("", nil)
	rr := hs.mustWrite(http.MethodDelete, "/v1/themes/ocean", "")
	if rr.Code != http.StatusNoContent || rr.Header().Get("ETag") == "" {
		t.Fatalf("delete: %d", rr.Code)
	}
	if favs := decode(t, hs.admin(http.MethodGet, "/v1/favourites"))["favourites"].([]any); len(favs) != 1 || favs[0] != "paper" {
		t.Fatalf("favourites %v", favs)
	}
}

func TestApps(t *testing.T) {
	hs := newHarness(t)
	hs.putApp("board")
	got := decode(t, hs.admin(http.MethodGet, "/v1/apps/board"))
	if got["name"] != "App board" || got["origins"].([]any)[0] != "https://board.test" {
		t.Fatalf("app %v", got)
	}
	if list := decode(t, hs.admin(http.MethodGet, "/v1/apps"))["apps"].([]any); len(list) != 1 {
		t.Fatalf("list %v", list)
	}
	for body, code := range map[string]string{
		`{"id":"board","name":"B","origins":[],"extra":1}`:                        "invalid_json",
		`{"ID":"board","name":"B","origins":[]}`:                                  "invalid_json",
		`{"id":"board","name":"B","origins":["http://board.test"]}`:               "invalid",
		`{"id":"board","name":"","origins":[]}`:                                   "invalid",
		`{"id":"other","name":"B","origins":[]}`:                                  "id_mismatch",
		`{"id":"board","name":"B","origins":["https://a.test","https://a.test"]}`: "invalid",
	} {
		rr := hs.write(http.MethodPut, "/v1/apps/board", body)
		if !strings.Contains(rr.Body.String(), `"code":"`+code+`"`) || rr.Code < 400 {
			t.Errorf("%s: %d %s", body, rr.Code, rr.Body.String())
		}
	}
	problem(t, hs.write(http.MethodPut, "/v1/apps/Bad_Id", `{"id":"Bad_Id","name":"B","origins":[]}`), 422, "invalid")
	hs.putTheme("ocean")
	hs.assign("", map[string]string{"board": "ocean"})
	hs.mustWrite(http.MethodDelete, "/v1/apps/board", "")
	if a := decode(t, hs.admin(http.MethodGet, "/v1/assignments")); len(a["perApp"].(map[string]any)) != 0 {
		t.Fatalf("assignment kept: %v", a)
	}
	problem(t, hs.write(http.MethodDelete, "/v1/apps/board", ""), http.StatusNotFound, "not_found")
}

func TestAssignmentsAndFavourites(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.putApp("board")
	problem(t, hs.write(http.MethodPut, "/v1/assignments", `{"global":"missing","perApp":{}}`), 422, "unknown_theme")
	problem(t, hs.write(http.MethodPut, "/v1/assignments", `{"global":null,"perApp":{"ghost":"none"}}`), 422, "unknown_app")
	problem(t, hs.write(http.MethodPut, "/v1/assignments", `{"global":null,"perApp":{"board":"missing"}}`), 422, "unknown_theme")
	problem(t, hs.write(http.MethodPut, "/v1/assignments", `{"perApp":{}}`), 422, "missing_field")
	problem(t, hs.write(http.MethodPut, "/v1/assignments", `{"global":null,"perApp":{},"x":1}`), 400, "invalid_json")
	hs.assign("ocean", map[string]string{"board": "none"})
	a := decode(t, hs.admin(http.MethodGet, "/v1/assignments"))
	if a["global"] != "ocean" || a["perApp"].(map[string]any)["board"] != "none" {
		t.Fatalf("assignments %v", a)
	}
	problem(t, hs.write(http.MethodPut, "/v1/favourites", `{"favourites":["missing"]}`), 422, "unknown_theme")
	problem(t, hs.write(http.MethodPut, "/v1/favourites", `{"favourites":["ocean","ocean"]}`), 422, "invalid")
	problem(t, hs.write(http.MethodPut, "/v1/favourites", `{}`), 422, "missing_field")
	hs.mustWrite(http.MethodPut, "/v1/favourites", `{"favourites":["ocean"]}`)
	if f := decode(t, hs.admin(http.MethodGet, "/v1/favourites"))["favourites"].([]any); len(f) != 1 {
		t.Fatalf("favourites %v", f)
	}
}

// TestAuditLine: one line per write attempt, with who, what and the
// result, and never the body.
func TestAuditLine(t *testing.T) {
	hs := newHarness(t)
	doc := themetest.Valid("ocean")
	doc["name"] = "Very Secret Name"
	hs.mustWrite(http.MethodPut, "/v1/themes/ocean", string(themetest.JSON(doc)))
	hs.do(http.MethodPut, "/v1/themes/ocean", string(themetest.JSON(doc)), without(1, "Origin")...)
	lines := strings.Split(strings.TrimSpace(hs.log.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("log lines:\n%s", hs.log.String())
	}
	for _, want := range []string{`"user":"alice"`, `"action":"put_theme"`, `"target":"ocean"`, `"status":201`, `"result":"ok"`} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("line %s lacks %s", lines[0], want)
		}
	}
	if !strings.Contains(lines[1], `"result":"refused"`) || !strings.Contains(lines[1], `"code":"bad_origin"`) {
		t.Errorf("refusal line %s", lines[1])
	}
	if strings.Contains(hs.log.String(), "Very Secret Name") || strings.Contains(hs.log.String(), "colorSpace") {
		t.Fatal("the log holds the body")
	}
}

// TestExtraRoutesAreGated: routes added for T-089 sit behind the same
// client-certificate gate and headers.
func TestExtraRoutesAreGated(t *testing.T) {
	hs := newHarness(t, func(o *Options) {
		o.Routes = []Route{{Pattern: "GET /v1/me/ping", Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			WriteJSON(w, 200, map[string]string{"pong": RequestID(r)})
		})}}
	})
	rr := hs.do(http.MethodGet, "/v1/me/ping", "")
	if rr.Code != 200 || rr.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("%d", rr.Code)
	}
	r := req(http.MethodGet, "/v1/me/ping", "")
	r.TLS = tlsState("npm-homepi")
	problem(t, hs.serve(r), http.StatusForbidden, "client_not_allowed")
}
