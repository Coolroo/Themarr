package server

import (
	"net/http"
	"testing"
)

// TestEscapedPathsAre404 (T-115 review): Go routes an escaped segment as
// one, while NPM and Authelia match the decoded, cleaned path. Any
// percent-escape in the path is 404 before routing, whoever asks, so the
// two never route one request to different places.
func TestEscapedPathsAre404(t *testing.T) {
	hs := newHarness(t)
	hs.putTheme("ocean")
	hs.putApp("board")
	hs.assign("ocean", nil)
	for _, path := range []string{
		// Decoded: the public bypass. Go: GET /v1/apps/{id}, an admin route.
		"/v1/apps/board%2Ftheme",
		"/v1/apps/board%2ftheme",
		// Decoded: the catalog. Go: the UI.
		"/v1%2Fcatalog",
		// Decoded: the drawer. Go: the UI.
		"/drawer%3Fapp=board",
		// Decoded and cleaned: /drawer. Go: GET /v1/themes/{id}.
		"/v1/themes/..%2F..%2Fdrawer",
		// Escaped dots, a double escape, an escape Go would not make, a
		// backslash, and any other escape.
		"/v1/themes/%2E%2E/apps",
		"/v1/apps/board%252Ftheme",
		"/v1/apps/bo%61rd/theme",
		"/v1/themes/ocean%5C",
		"/v1/themes/%C3%A9",
		// A character Go would have escaped.
		"/v1/apps/bo!ard/theme",
	} {
		for _, headers := range [][]string{nil, adminHeaders} {
			problem(t, hs.do(http.MethodGet, path, "", headers...), http.StatusNotFound, "not_found")
		}
	}
	// Plain paths, with a query, still route.
	for _, c := range []struct {
		path string
		want int
	}{
		{"/v1/apps/board/theme", 200},
		{"/v1/catalog", 200},
		{"/v1/themes/ocean/tokens", 200},
		{"/editor/ocean?x=%2F", 200},
	} {
		if rr := hs.do(http.MethodGet, c.path, ""); rr.Code != c.want {
			t.Errorf("%s: %d, want %d", c.path, rr.Code, c.want)
		}
	}
}
