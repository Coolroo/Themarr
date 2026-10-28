package server

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// DrawerPath is the one page themarr lets other sites frame: the SDK's
// drawer, an iframe inside each app (decision 0009).
const DrawerPath = "/drawer"

// drawerCSP is the drawer page's policy before its frame-ancestors: its own
// files only, like the admin UI.
const drawerCSP = "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors "

// frameOrigin is an origin as the store keeps it (https, lower-case host,
// optional port). Checked again here because it goes into a header.
var frameOrigin = regexp.MustCompile(`^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$`)

// frameable says whether an answer may be framed at all: GET or HEAD of
// /drawer, and nothing else. The drawer handler then decides by whom
// (frameAncestors), and sends DENY itself when nobody may.
func frameable(r *http.Request) bool {
	return (r.Method == http.MethodGet || r.Method == http.MethodHead) && r.URL.Path == DrawerPath
}

// frameAncestors is the space-separated list of the origins registered for
// the app the query names (?app=<id>), or "" when the query names no valid,
// registered app with origins. Exact origins only, never a wildcard.
func (s *Server) frameAncestors(r *http.Request) string {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return ""
	}
	ids := q["app"]
	if len(ids) != 1 || !s.opt.Manifest.ValidID(ids[0]) {
		return ""
	}
	app, ok := s.store.Snapshot().Apps[ids[0]]
	if !ok {
		return ""
	}
	var list []string
	for _, o := range app.Origins {
		if frameOrigin.MatchString(o) {
			list = append(list, o)
		}
	}
	return strings.Join(list, " ")
}

// drawerPage serves GET|HEAD /drawer: the drawer page (Options.Drawer),
// framed only by the origins registered for ?app=. Without them the page
// still loads on its own (a new tab), but no site may frame it.
func (s *Server) drawerPage(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	ancestors := s.frameAncestors(r)
	if ancestors == "" {
		ancestors = "'none'"
		h.Set("X-Frame-Options", "DENY")
	}
	if s.opt.Drawer == nil {
		h.Set("X-Frame-Options", "DENY")
		Problem(w, r, http.StatusNotFound, "not_found", "No such endpoint.")
		return
	}
	h.Set("Content-Security-Policy", drawerCSP+ancestors)
	h.Set("Cache-Control", "no-cache")
	s.opt.Drawer.ServeHTTP(w, r)
}
