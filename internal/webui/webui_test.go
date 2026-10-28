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
