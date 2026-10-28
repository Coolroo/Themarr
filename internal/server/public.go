package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
)

// public sets the headers every public answer gets, errors included, so a
// browser app can tell "themarr answered" from "themarr is unreachable":
// CORS for any origin without credentials, and revalidation on every use.
// Public handlers never read Remote-User or Remote-Groups: on this path
// (an Authelia bypass) anybody can send them.
func public(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Expose-Headers", "ETag, X-Request-Id")
		h.Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

// appTheme serves GET|HEAD /v1/apps/{app}/theme: the app's theme (200), or
// nothing set (204).
func (s *Server) appTheme(w http.ResponseWriter, r *http.Request) {
	app := r.PathValue("app")
	if !s.opt.Manifest.ValidID(app) {
		Problem(w, r, http.StatusNotFound, "not_found", "No such app.")
		return
	}
	d := s.store.Snapshot()
	res := s.opt.Resolver(d, app)
	if _, registered := d.Apps[app]; registered {
		// Only registered apps: an unknown id must not grow the map.
		s.checks.record(app, res, s.opt.Now())
	}
	if res.Theme == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.serveTokens(w, r, d, res.Theme)
}

// themeTokens serves GET|HEAD /v1/themes/{id}/tokens: one theme's public
// view by id, for a person's local override in the SDK (the browser keeps
// only the theme id).
func (s *Server) themeTokens(w http.ResponseWriter, r *http.Request) {
	d := s.store.Snapshot()
	t := d.Themes[r.PathValue("id")]
	if t == nil {
		Problem(w, r, http.StatusNotFound, "not_found", "No such theme.")
		return
	}
	s.serveTokens(w, r, d, t)
}

// serveTokens writes t's public view with its ETag, or 304 when the
// client's If-None-Match already names it.
func (s *Server) serveTokens(w http.ResponseWriter, r *http.Request, d *store.Data, t *theme.Theme) {
	tag := themeETag(t, d.Version)
	w.Header().Set("ETag", tag)
	if noneMatch(r.Header.Values("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		return
	}
	WriteJSON(w, http.StatusOK, t.Public())
}

// themeETag is a strong tag for one theme's public view at one store
// version. The store version is part of it because a theme deleted and
// made again starts at version 1 again.
func themeETag(t *theme.Theme, storeVersion uint64) string {
	sum := sha256.Sum256([]byte(t.ID + "\x00" + strconv.FormatInt(t.Version, 10) + "\x00" + strconv.FormatUint(storeVersion, 10)))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

// NoneMatch reports whether a request's If-None-Match names tag, for
// packages that add routes with a 304.
func NoneMatch(r *http.Request, tag string) bool {
	return noneMatch(r.Header.Values("If-None-Match"), tag)
}

// noneMatch reports whether If-None-Match (RFC 9110 13.1.2, weak
// comparison) names tag, or is "*".
func noneMatch(values []string, tag string) bool {
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			if part == "*" || strings.TrimPrefix(part, "W/") == tag {
				return true
			}
		}
	}
	return false
}

// Check is the last time an app asked for its theme, and what it got.
type Check struct {
	At     time.Time `json:"at"`
	Result string    `json:"result"`          // "applied" or "unset"
	Theme  string    `json:"theme,omitempty"` // the theme id, when applied
}

// checks keeps the last check of each registered app, in memory only.
type checks struct {
	mu   sync.Mutex
	last map[string]Check
}

func newChecks() *checks { return &checks{last: map[string]Check{}} }

func (c *checks) record(app string, res Resolution, at time.Time) {
	ch := Check{At: at.UTC(), Result: "unset"}
	if res.Theme != nil {
		ch.Result, ch.Theme = "applied", res.Theme.ID
	}
	c.mu.Lock()
	c.last[app] = ch
	c.mu.Unlock()
}

func (c *checks) get(app string) (Check, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.last[app]
	return ch, ok
}

func (c *checks) forget(app string) {
	c.mu.Lock()
	delete(c.last, app)
	c.mu.Unlock()
}
