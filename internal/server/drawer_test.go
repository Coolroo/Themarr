package server

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// drawerHarness has a drawer page that, like the real one, sets no CSP.
func drawerHarness(t *testing.T) *harness {
	return newHarness(t, func(o *Options) {
		o.Drawer = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			io.WriteString(w, "<html>drawer</html>")
		})
	})
}

func TestDrawerFrameAncestorsAreTheAppsOrigins(t *testing.T) {
	hs := drawerHarness(t)
	hs.mustWrite(http.MethodPut, "/v1/apps/board",
		`{"id":"board","name":"Board","origins":["https://board.coolroo.dev","https://board.test:8443"]}`)
	hs.putApp("other")
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		rr := hs.do(method, "/drawer?app=board", "")
		h := rr.Header()
		if rr.Code != 200 {
			t.Fatalf("%s: %d", method, rr.Code)
		}
		want := drawerCSP + "https://board.coolroo.dev https://board.test:8443"
		if h.Get("Content-Security-Policy") != want {
			t.Fatalf("%s: CSP %q", method, h.Get("Content-Security-Policy"))
		}
		if h.Get("X-Frame-Options") != "" {
			t.Fatalf("%s: X-Frame-Options %q on a framable answer", method, h.Get("X-Frame-Options"))
		}
		if h.Get("Cache-Control") != "no-cache" || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s: headers %v", method, h)
		}
	}
	if rr := hs.do(http.MethodGet, "/drawer?app=board", ""); rr.Body.String() != "<html>drawer</html>" {
		t.Fatalf("body %q", rr.Body.String())
	}
	// Another app's page lists only that app's origins.
	rr := hs.do(http.MethodGet, "/drawer?app=other", "")
	if got := rr.Header().Get("Content-Security-Policy"); got != drawerCSP+"https://other.test" {
		t.Fatalf("other: %q", got)
	}
	// The identity headers don't change the answer.
	rr = hs.do(http.MethodGet, "/drawer?app=other", "", "Remote-User", "alice", "Remote-Groups", "admins")
	if got := rr.Header().Get("Content-Security-Policy"); got != drawerCSP+"https://other.test" {
		t.Fatalf("with Remote-*: %q", got)
	}
}

func TestDrawerWithoutARegisteredAppIsNeverFramed(t *testing.T) {
	hs := drawerHarness(t)
	hs.putApp("board")
	hs.mustWrite(http.MethodPut, "/v1/apps/bare", `{"id":"bare","name":"Bare","origins":[]}`)
	for _, q := range []string{
		"",                         // no app
		"?app=",                    // empty
		"?app=ghost",               // not registered
		"?app=Board",               // not a valid id
		"?app=board&app=board",     // repeated
		"?app=bare",                // registered without origins
		"?app=%zz",                 // a query that doesn't parse
		"?app=board%20https://x.y", // not an id
	} {
		rr := hs.do(http.MethodGet, "/drawer"+q, "")
		h := rr.Header()
		if rr.Code != 200 || h.Get("X-Frame-Options") != "DENY" || h.Get("Content-Security-Policy") != drawerCSP+"'none'" {
			t.Errorf("%q: %d XFO %q CSP %q", q, rr.Code, h.Get("X-Frame-Options"), h.Get("Content-Security-Policy"))
		}
	}
}

func TestOnlyTheDrawerIsFramable(t *testing.T) {
	hs := drawerHarness(t)
	hs.putApp("board")
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/"},
		{http.MethodGet, "/drawer/"},
		{http.MethodGet, "/drawer.html?app=board"},
		{http.MethodGet, "/drawer/x?app=board"},
		{http.MethodGet, "/Drawer?app=board"},
		{http.MethodGet, "/v1/catalog"},
		{http.MethodGet, "/v1/apps/board/theme"},
		{http.MethodGet, "/v1/themes"},
		{http.MethodGet, "/v1/drawer?app=board"},
		{http.MethodPost, "/drawer?app=board"},
		{http.MethodPut, "/drawer?app=board"},
	} {
		rr := hs.do(c.method, c.path, "", adminHeaders...)
		h := rr.Header()
		if h.Get("X-Frame-Options") != "DENY" || !strings.Contains(h.Get("Content-Security-Policy"), "frame-ancestors 'none'") &&
			h.Get("Content-Security-Policy") != "ui-policy" {
			t.Errorf("%s %s: XFO %q CSP %q", c.method, c.path, h.Get("X-Frame-Options"), h.Get("Content-Security-Policy"))
		}
	}
	// The UI's own policy (webui.CSP) has frame-ancestors 'none'; the test UI
	// stands in with "ui-policy", so check the XFO there.
	if rr := hs.do(http.MethodGet, "/themes", ""); rr.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("the UI is framable")
	}
}

func TestDrawerWithoutAPageIs404AndDenied(t *testing.T) {
	hs := newHarness(t)
	hs.putApp("board")
	rr := hs.do(http.MethodGet, "/drawer?app=board", "")
	problem(t, rr, http.StatusNotFound, "not_found")
	if rr.Header().Get("X-Frame-Options") != "DENY" || rr.Header().Get("Content-Security-Policy") != apiCSP {
		t.Fatalf("headers %v", rr.Header())
	}
}

func TestFrameable(t *testing.T) {
	for _, c := range []struct {
		method, target string
		want           bool
	}{
		{http.MethodGet, "/drawer", true},
		{http.MethodGet, "/drawer?app=x", true},
		{http.MethodHead, "/drawer?app=x", true},
		{http.MethodPost, "/drawer?app=x", false},
		{http.MethodGet, "/drawer/", false},
		{http.MethodGet, "/", false},
		{http.MethodGet, "/v1/catalog", false},
	} {
		if got := frameable(req(c.method, c.target, "")); got != c.want {
			t.Errorf("%s %s: %v", c.method, c.target, got)
		}
	}
}
