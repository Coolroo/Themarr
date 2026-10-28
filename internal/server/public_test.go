package server

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme/themetest"
)

func checkCORS(t *testing.T, h http.Header) {
	t.Helper()
	if h.Get("Access-Control-Allow-Origin") != "*" || h.Get("Access-Control-Allow-Credentials") != "" {
		t.Errorf("CORS headers %v", h)
	}
	if !strings.Contains(h.Get("Access-Control-Expose-Headers"), "ETag") {
		t.Errorf("ETag not exposed: %v", h)
	}
	if h.Get("Cache-Control") != "no-cache" {
		t.Errorf("Cache-Control %q", h.Get("Cache-Control"))
	}
}

func TestNothingSetIs204(t *testing.T) {
	hs := newHarness(t)
	hs.putApp("board")
	for _, app := range []string{"board", "unregistered"} {
		rr := hs.do(http.MethodGet, "/v1/apps/"+app+"/theme", "")
		if rr.Code != http.StatusNoContent || rr.Body.Len() != 0 || rr.Header().Get("ETag") != "" {
			t.Fatalf("%s: %d %q", app, rr.Code, rr.Body.String())
		}
		checkCORS(t, rr.Header())
	}
}

// TestPublicBodyHoldsColoursOnly: version, modes and tokens; never the id,
// name or source (decision 0004).
func TestPublicBodyHoldsColoursOnly(t *testing.T) {
	hs := newHarness(t)
	hs.mustWrite(http.MethodPut, "/v1/themes/brand", string(themetest.JSON(themetest.Seeded("brand"))))
	hs.assign("brand", nil)
	rr := hs.do(http.MethodGet, "/v1/apps/board/theme", "")
	if rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %v", rr.Code, rr.Header())
	}
	checkCORS(t, rr.Header())
	body := decode(t, rr)
	keys := []string{}
	for k := range body {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "modes,tokens,version" {
		t.Fatalf("keys %v", keys)
	}
	if strings.Contains(rr.Body.String(), "#3366ff") || strings.Contains(rr.Body.String(), "Theme brand") {
		t.Fatal("the public body holds the seed or the name")
	}
	tok := body["tokens"].(map[string]any)["light"].(map[string]any)["primary"].(map[string]any)
	if tok["$type"] != "color" || tok["$value"].(map[string]any)["colorSpace"] != "srgb" {
		t.Fatalf("token %v", tok)
	}
	if body["version"] != float64(1) {
		t.Fatalf("version %v", body["version"])
	}
}

func TestResolutionOrder(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("global-one")
	hs.putTheme("own", "dark")
	for _, a := range []string{"mine", "off", "inheriting", "plain"} {
		hs.putApp(a)
	}
	hs.assign("global-one", map[string]string{"mine": "own", "off": store.None, "inheriting": store.Inherit})
	for app, want := range map[string][]string{
		"mine":       {"dark"},
		"inheriting": {"light", "dark"},
		"plain":      {"light", "dark"},
		"unknown":    {"light", "dark"}, // like a registered app without an assignment
	} {
		rr := hs.do(http.MethodGet, "/v1/apps/"+app+"/theme", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("%s: %d", app, rr.Code)
		}
		var b struct{ Modes []string }
		json.Unmarshal(rr.Body.Bytes(), &b)
		if strings.Join(b.Modes, ",") != strings.Join(want, ",") {
			t.Errorf("%s: modes %v, want %v", app, b.Modes, want)
		}
	}
	if rr := hs.do(http.MethodGet, "/v1/apps/off/theme", ""); rr.Code != http.StatusNoContent {
		t.Fatalf("none: %d", rr.Code)
	}
}

func TestETagAnd304(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.assign("ocean", nil)
	rr := hs.do(http.MethodGet, "/v1/apps/board/theme", "")
	tag := rr.Header().Get("ETag")
	if rr.Code != 200 || len(tag) < 3 || tag[0] != '"' || strings.HasPrefix(tag, "W/") {
		t.Fatalf("%d tag %q", rr.Code, tag)
	}
	for _, inm := range []string{tag, "W/" + tag, `"other", ` + tag, "*"} {
		rr := hs.do(http.MethodGet, "/v1/apps/board/theme", "", "If-None-Match", inm)
		if rr.Code != http.StatusNotModified || rr.Body.Len() != 0 || rr.Header().Get("ETag") != tag {
			t.Fatalf("If-None-Match %s: %d %q", inm, rr.Code, rr.Body.String())
		}
		checkCORS(t, rr.Header())
	}
	if rr := hs.do(http.MethodGet, "/v1/apps/board/theme", "", "If-None-Match", `"other"`); rr.Code != 200 {
		t.Fatalf("other tag: %d", rr.Code)
	}
	// The theme changes: the old tag no longer matches.
	hs.putTheme("ocean")
	rr = hs.do(http.MethodGet, "/v1/apps/board/theme", "", "If-None-Match", tag)
	if rr.Code != 200 || rr.Header().Get("ETag") == tag {
		t.Fatalf("after an update: %d %q", rr.Code, rr.Header().Get("ETag"))
	}
	// Deleted and made again (version 1 again): still a new tag.
	newTag := rr.Header().Get("ETag")
	hs.assign("", nil)
	hs.mustWrite(http.MethodDelete, "/v1/themes/ocean", "")
	hs.putTheme("ocean")
	hs.assign("ocean", nil)
	rr = hs.do(http.MethodGet, "/v1/apps/board/theme", "")
	if rr.Header().Get("ETag") == newTag || rr.Header().Get("ETag") == tag {
		t.Fatal("a re-made theme kept an old tag")
	}
}

func TestHeadHasNoBody(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.assign("ocean", nil)
	rr := hs.do(http.MethodHead, "/v1/apps/board/theme", "")
	if rr.Code != 200 || rr.Body.Len() != 0 || rr.Header().Get("ETag") == "" {
		t.Fatalf("%d %d bytes", rr.Code, rr.Body.Len())
	}
}

// TestPublicIgnoresRemoteHeaders: identity headers on the public route
// change nothing (anybody can send them on the Authelia bypass).
func TestPublicIgnoresRemoteHeaders(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.putApp("board")
	hs.assign("ocean", map[string]string{"board": store.None})
	plain := hs.do(http.MethodGet, "/v1/apps/board/theme", "")
	spoofed := hs.do(http.MethodGet, "/v1/apps/board/theme", "", "Remote-User", "alice", "Remote-Groups", "admins")
	if plain.Code != http.StatusNoContent || spoofed.Code != plain.Code || spoofed.Body.String() != plain.Body.String() {
		t.Fatalf("plain %d, with Remote-* %d", plain.Code, spoofed.Code)
	}
	a := hs.do(http.MethodGet, "/v1/themes/ocean/tokens", "")
	b := hs.do(http.MethodGet, "/v1/themes/ocean/tokens", "", "Remote-User", "alice", "Remote-Groups", "admins")
	if a.Code != 200 || b.Code != 200 || a.Body.String() != b.Body.String() {
		t.Fatal("Remote-* changed the tokens answer")
	}
}

func TestThemeTokensByID(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("synth", "dark")
	rr := hs.do(http.MethodGet, "/v1/themes/synth/tokens", "")
	if rr.Code != 200 {
		t.Fatalf("%d", rr.Code)
	}
	checkCORS(t, rr.Header())
	body := decode(t, rr)
	if _, has := body["id"]; has || body["modes"].([]any)[0] != "dark" {
		t.Fatalf("body %v", body)
	}
	tag := rr.Header().Get("ETag")
	if rr := hs.do(http.MethodGet, "/v1/themes/synth/tokens", "", "If-None-Match", tag); rr.Code != http.StatusNotModified {
		t.Fatalf("304: %d", rr.Code)
	}
	rr = hs.do(http.MethodGet, "/v1/themes/missing/tokens", "")
	problem(t, rr, http.StatusNotFound, "not_found")
	checkCORS(t, rr.Header())
}

// TestPublicErrorsCarryCORS: an error a browser app can read, so it can
// tell an answer from an unreachable themarr.
func TestPublicErrorsCarryCORS(t *testing.T) {
	hs := newHarness(t)
	rr := hs.do(http.MethodGet, "/v1/apps/Not_Valid/theme", "")
	problem(t, rr, http.StatusNotFound, "not_found")
	checkCORS(t, rr.Header())
}

func TestLastCheck(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.putApp("board")
	if body := decode(t, hs.admin(http.MethodGet, "/v1/apps/board/last-check")); body["lastCheck"] != nil {
		t.Fatalf("never checked: %v", body)
	}
	hs.do(http.MethodGet, "/v1/apps/board/theme", "")
	body := decode(t, hs.admin(http.MethodGet, "/v1/apps/board/last-check"))
	lc := body["lastCheck"].(map[string]any)
	if lc["result"] != "unset" || lc["at"] != "2026-10-28T12:00:00Z" {
		t.Fatalf("unset check %v", lc)
	}
	hs.assign("ocean", nil)
	hs.do(http.MethodGet, "/v1/apps/board/theme", "")
	lc = decode(t, hs.admin(http.MethodGet, "/v1/apps/board/last-check"))["lastCheck"].(map[string]any)
	if lc["result"] != "applied" || lc["theme"] != "ocean" {
		t.Fatalf("applied check %v", lc)
	}
	// Unknown apps are not recorded, and have no last check.
	hs.do(http.MethodGet, "/v1/apps/ghost/theme", "")
	problem(t, hs.admin(http.MethodGet, "/v1/apps/ghost/last-check"), http.StatusNotFound, "not_found")
	if _, ok := hs.srv.checks.get("ghost"); ok {
		t.Fatal("an unknown app was recorded")
	}
	// Deleting the app forgets its check.
	hs.assign("ocean", nil)
	hs.mustWrite(http.MethodDelete, "/v1/apps/board", "")
	if _, ok := hs.srv.checks.get("board"); ok {
		t.Fatal("a deleted app's check was kept")
	}
}

// TestResolverSeam: another resolver (T-089's layered one) replaces the
// default without touching the route.
func TestResolverSeam(t *testing.T) {
	hs := newHarness(t, func(o *Options) {
		o.Resolver = func(d *store.Data, app string) Resolution {
			if app == "special" {
				return Resolution{Theme: d.Themes["ocean"], From: "test"}
			}
			return Resolution{}
		}
	})
	hs.putTheme("ocean")
	if rr := hs.do(http.MethodGet, "/v1/apps/special/theme", ""); rr.Code != 200 {
		t.Fatalf("special: %d", rr.Code)
	}
	if rr := hs.do(http.MethodGet, "/v1/apps/other/theme", ""); rr.Code != 204 {
		t.Fatalf("other: %d", rr.Code)
	}
}
