package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServesIndexWithCSP(t *testing.T) {
	h := Handler()
	for _, p := range []string{"/", "/index.html", "/themes/ocean", "/../../etc/passwd"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, p, nil))
		if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "<title>Themarr</title>") {
			t.Errorf("%s: %d %.80q", p, rr.Code, rr.Body.String())
		}
		if rr.Header().Get("Content-Security-Policy") != CSP || !strings.Contains(CSP, "frame-ancestors 'none'") {
			t.Errorf("%s: CSP %q", p, rr.Header().Get("Content-Security-Policy"))
		}
		if !strings.HasPrefix(rr.Header().Get("Content-Type"), "text/html") {
			t.Errorf("%s: content type %q", p, rr.Header().Get("Content-Type"))
		}
	}
}

func TestHeadHasNoBody(t *testing.T) {
	rr := httptest.NewRecorder()
	Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodHead, "/", nil))
	if rr.Code != http.StatusOK || rr.Body.Len() != 0 {
		t.Fatalf("%d, %d bytes", rr.Code, rr.Body.Len())
	}
}

// TestDrawerPage: the drawer page is embedded, and its handler leaves the
// CSP to the server (which sets frame-ancestors per app).
func TestDrawerPage(t *testing.T) {
	for _, m := range []string{http.MethodGet, http.MethodHead} {
		rr := httptest.NewRecorder()
		Drawer().ServeHTTP(rr, httptest.NewRequest(m, "/drawer?app=board", nil))
		if rr.Code != http.StatusOK || !strings.HasPrefix(rr.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("%s: %d %v", m, rr.Code, rr.Header())
		}
		if rr.Header().Get("Content-Security-Policy") != "" {
			t.Fatalf("%s: the drawer handler set a CSP", m)
		}
		if m == http.MethodGet && !strings.Contains(rr.Body.String(), `<title>Themarr drawer</title>`) {
			t.Fatalf("body %.120q", rr.Body.String())
		}
		if m == http.MethodHead && rr.Body.Len() != 0 {
			t.Fatal("HEAD has a body")
		}
	}
}
