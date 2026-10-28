package server

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/strictjson"
	"github.com/Coolroo/themarr/internal/theme"
)

// Body limits: a theme with two modes is about 15 KiB as the admin UI sends
// it; everything else is far smaller.
const (
	maxThemeBody = 128 << 10
	maxOtherBody = 32 << 10
)

// RemoteHeaders is the default Identify: Authelia's Remote-User and
// Remote-Groups (comma-separated), each sent exactly once
// (identity.Authelia). It is used only on routes behind Authelia, where
// the CN pin guarantees tls-gateway sent them.
func RemoteHeaders(r *http.Request) (Identity, bool) {
	return identity.Authelia{}.Identify(r)
}

// adminHandler is an admin route's handler, given the caller's identity.
type adminHandler func(w http.ResponseWriter, r *http.Request, who Identity)

// admin refuses a caller without an identity (401) or outside the admin
// group (403).
func (s *Server) admin(h adminHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := s.opt.Identify(r)
		if !ok {
			Problem(w, r, http.StatusUnauthorized, "unauthenticated", "Sign in first.")
			return
		}
		for _, g := range who.Groups {
			if g == s.opt.AdminGroup {
				h(w, r, who)
				return
			}
		}
		Problem(w, r, http.StatusForbidden, "not_admin", "Only admins may use this route.")
	}
}

// writeHandler is an admin write, given the store version the caller read.
type writeHandler func(w http.ResponseWriter, r *http.Request, expected uint64) (target string)

// recorder notes the status and problem code of an answer, for the audit
// line.
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

// RecordProblem implements ProblemRecorder.
func (r *recorder) RecordProblem(code string) { r.code = code }

// write checks what every admin write needs (the Origin, Sec-Fetch-Site,
// If-Match) and records one audit line for the attempt: who, what, the
// result. Never the body.
func (s *Server) write(action string, h writeHandler) adminHandler {
	return func(w http.ResponseWriter, r *http.Request, who Identity) {
		rec := &recorder{ResponseWriter: w}
		target := r.PathValue("id")
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
			s.log.Info("write", slog.String("request_id", RequestID(r)), slog.String("user", who.User),
				slog.String("action", action), slog.String("target", target), slog.Int("status", status),
				slog.String("result", result), slog.String("code", rec.code),
				slog.Uint64("store_version", s.store.Snapshot().Version))
		}()
		expected, ok := CheckWrite(rec, r, s.opt.PublicOrigin, "")
		if !ok {
			return
		}
		target = h(rec, r, expected)
	}
}

// CheckWrite checks what every write needs before its body is read:
// exactly one Origin equal to publicOrigin, exactly one Sec-Fetch-Site:
// same-origin, and exactly one If-Match, a strong tag of prefix and a
// version ("12" for the store, "p7" for internal/prefs). It returns the
// version, or writes the refusal and returns false.
func CheckWrite(w http.ResponseWriter, r *http.Request, publicOrigin, prefix string) (uint64, bool) {
	if origins := r.Header.Values("Origin"); len(origins) != 1 || origins[0] != publicOrigin {
		Problem(w, r, http.StatusForbidden, "bad_origin", "Writes must come from themarr's own pages.")
		return 0, false
	}
	if sites := r.Header.Values("Sec-Fetch-Site"); len(sites) != 1 || sites[0] != "same-origin" {
		Problem(w, r, http.StatusForbidden, "cross_site", "Writes must be same-origin requests (Sec-Fetch-Site).")
		return 0, false
	}
	expected, status, code, detail := ifMatch(r, prefix)
	if status != 0 {
		Problem(w, r, status, code, detail)
		return 0, false
	}
	return expected, true
}

// ifMatch reads a version from If-Match: exactly one strong tag,
// "<prefix><version>".
func ifMatch(r *http.Request, prefix string) (v uint64, status int, code, detail string) {
	example := `"` + prefix + `12"`
	vals := r.Header.Values("If-Match")
	if len(vals) == 0 {
		return 0, http.StatusPreconditionRequired, "if_match_required", "Send If-Match with the version (the ETag of a read)."
	}
	tag := strings.TrimSpace(vals[0])
	if len(vals) != 1 || len(tag) < 3+len(prefix) || tag[0] != '"' || tag[len(tag)-1] != '"' ||
		!strings.HasPrefix(tag[1:], prefix) {
		return 0, http.StatusBadRequest, "bad_if_match", "If-Match must be one strong tag, such as " + example + "."
	}
	n, err := strconv.ParseUint(tag[1+len(prefix):len(tag)-1], 10, 64)
	if err != nil {
		return 0, http.StatusBadRequest, "bad_if_match", "If-Match must be one strong tag, such as " + example + "."
	}
	return n, 0, "", ""
}

// storeTag is the ETag of an admin answer: the store version.
func storeTag(v uint64) string { return `"` + strconv.FormatUint(v, 10) + `"` }

// isJSON accepts exactly application/json, with at most a utf-8 charset.
func isJSON(ct string) bool {
	mt, params, err := mime.ParseMediaType(ct)
	if err != nil || mt != "application/json" {
		return false
	}
	for k, v := range params {
		if k != "charset" || !strings.EqualFold(v, "utf-8") {
			return false
		}
	}
	return true
}

// readBody reads a JSON body of at most limit bytes, or writes the refusal.
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	if cts := r.Header.Values("Content-Type"); len(cts) != 1 || !isJSON(cts[0]) {
		Problem(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send Content-Type: application/json.")
		return nil, false
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			Problem(w, r, http.StatusRequestEntityTooLarge, "too_large", "The body is too large.")
			return nil, false
		}
		Problem(w, r, http.StatusBadRequest, "invalid_json", "The body could not be read.")
		return nil, false
	}
	return b, true
}

// ReadJSON reads a write's body for packages that add routes: exactly one
// Content-Type: application/json (charset utf-8 at most) and at most 32
// KiB. It writes the refusal and returns false otherwise.
func ReadJSON(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	return readBody(w, r, maxOtherBody)
}

// NoBody refuses a DELETE that carries a body, for packages that add
// routes.
func NoBody(w http.ResponseWriter, r *http.Request) bool { return noBody(w, r) }

// noBody refuses a DELETE that carries a body.
func noBody(w http.ResponseWriter, r *http.Request) bool {
	n, err := r.Body.Read(make([]byte, 1))
	if n > 0 || (err != nil && err != io.EOF) || r.ContentLength > 0 {
		Problem(w, r, http.StatusBadRequest, "unexpected_body", "A DELETE takes no body.")
		return false
	}
	return true
}

// errNotFound and errInUse are refusals decided inside a store update.
var (
	errNotFound = errors.New("not found")
	errInUse    = errors.New("in use")
)

// updated answers a store update's outcome: the error's refusal, or ok.
// It returns false after writing a refusal.
func (s *Server) updated(w http.ResponseWriter, r *http.Request, err error) bool {
	var rule *store.RuleError
	switch {
	case err == nil:
		return true
	case errors.Is(err, store.ErrConflict):
		Problem(w, r, http.StatusPreconditionFailed, "version_conflict", "The data changed since you read it; read it again.")
	case errors.Is(err, errNotFound):
		Problem(w, r, http.StatusNotFound, "not_found", "No such item.")
	case errors.Is(err, errInUse):
		Problem(w, r, http.StatusConflict, "in_use", "The theme is assigned or a policy names it; change those first.")
	case errors.As(err, &rule):
		Problem(w, r, http.StatusUnprocessableEntity, rule.Code, rule.Detail)
	default:
		// The cause (a disk error) goes to the log, not to the caller.
		s.log.Error("store write failed", slog.String("request_id", RequestID(r)), slog.String("error", err.Error()))
		Problem(w, r, http.StatusInternalServerError, "store_failed", "The change could not be saved.")
	}
	return false
}

// --- themes ---

func (s *Server) listThemes(w http.ResponseWriter, r *http.Request, _ Identity) {
	d := s.store.Snapshot()
	list := make([]*theme.Theme, 0, len(d.Themes))
	for _, id := range d.ThemeIDs() {
		list = append(list, d.Themes[id])
	}
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, map[string]any{"themes": list})
}

func (s *Server) getTheme(w http.ResponseWriter, r *http.Request, _ Identity) {
	d := s.store.Snapshot()
	t := d.Themes[r.PathValue("id")]
	if t == nil {
		Problem(w, r, http.StatusNotFound, "not_found", "No such theme.")
		return
	}
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, t)
}

// putTheme creates or replaces a theme. The theme's version is the
// server's: 1 for a new theme, one more than the stored one otherwise,
// whatever the body says.
func (s *Server) putTheme(w http.ResponseWriter, r *http.Request, expected uint64) string {
	id := r.PathValue("id")
	body, ok := readBody(w, r, maxThemeBody)
	if !ok {
		return id
	}
	t, err := s.opt.Manifest.Parse(body)
	var inv *theme.Invalid
	switch {
	case errors.As(err, &inv):
		ProblemWith(w, r, http.StatusUnprocessableEntity, "invalid_theme", "The theme breaks the token rules; see issues.",
			map[string]any{"issues": inv.Issues})
		return id
	case err != nil:
		Problem(w, r, http.StatusBadRequest, "invalid_json", "The body must be one JSON object, valid UTF-8, without repeated keys.")
		return id
	}
	if t.ID != id {
		Problem(w, r, http.StatusUnprocessableEntity, "id_mismatch", "The theme's id must be the id in the path.")
		return id
	}
	if !theme.ValidSlug(id) {
		Problem(w, r, http.StatusUnprocessableEntity, "bad_id", "inherit and none can't be theme ids.")
		return id
	}
	created := false
	d, err := s.store.Update(expected, func(d *store.Data) error {
		next := *t
		next.Version = 1
		if old := d.Themes[id]; old != nil {
			next.Version = old.Version + 1
		} else {
			created = true
		}
		d.Themes[id] = &next
		return nil
	})
	if !s.updated(w, r, err) {
		return id
	}
	w.Header().Set("ETag", storeTag(d.Version))
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	WriteJSON(w, status, d.Themes[id])
	return id
}

// deleteTheme removes a theme that no assignment and no policy
// (Options.ThemeInUse) names, and takes it out of the favourites. The
// policy check and the delete hold different locks, so a policy written
// at the same moment can still name the deleted theme; the resolver then
// skips that policy (internal/resolve).
func (s *Server) deleteTheme(w http.ResponseWriter, r *http.Request, expected uint64) string {
	id := r.PathValue("id")
	if !noBody(w, r) {
		return id
	}
	d, err := s.store.Update(expected, func(d *store.Data) error {
		if d.Themes[id] == nil {
			return errNotFound
		}
		if s.opt.ThemeInUse != nil && s.opt.ThemeInUse(id) {
			return errInUse
		}
		if g := d.Assignments.Global; g != nil && *g == id {
			return errInUse
		}
		for _, v := range d.Assignments.PerApp {
			if v == id {
				return errInUse
			}
		}
		delete(d.Themes, id)
		favs := []string{}
		for _, f := range d.Favourites {
			if f != id {
				favs = append(favs, f)
			}
		}
		d.Favourites = favs
		return nil
	})
	if !s.updated(w, r, err) {
		return id
	}
	w.Header().Set("ETag", storeTag(d.Version))
	w.WriteHeader(http.StatusNoContent)
	return id
}

// --- apps ---

var appFields = map[string][]string{"": {"id", "name", "origins"}}

func (s *Server) listApps(w http.ResponseWriter, r *http.Request, _ Identity) {
	d := s.store.Snapshot()
	list := make([]store.App, 0, len(d.Apps))
	for _, id := range d.AppIDs() {
		list = append(list, d.Apps[id])
	}
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, map[string]any{"apps": list})
}

func (s *Server) getApp(w http.ResponseWriter, r *http.Request, _ Identity) {
	d := s.store.Snapshot()
	a, ok := d.Apps[r.PathValue("id")]
	if !ok {
		Problem(w, r, http.StatusNotFound, "not_found", "No such app.")
		return
	}
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, a)
}

func (s *Server) putApp(w http.ResponseWriter, r *http.Request, expected uint64) string {
	id := r.PathValue("id")
	body, ok := readBody(w, r, maxOtherBody)
	if !ok {
		return id
	}
	var a store.App
	if err := strictjson.Decode(body, &a, appFields); err != nil {
		Problem(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return id
	}
	if a.ID != id {
		Problem(w, r, http.StatusUnprocessableEntity, "id_mismatch", "The app's id must be the id in the path.")
		return id
	}
	if a.Origins == nil {
		a.Origins = []string{}
	}
	if err := store.CheckApp(a); err != nil {
		s.updated(w, r, err)
		return id
	}
	created := false
	d, err := s.store.Update(expected, func(d *store.Data) error {
		_, exists := d.Apps[id]
		created = !exists
		d.Apps[id] = a
		return nil
	})
	if !s.updated(w, r, err) {
		return id
	}
	w.Header().Set("ETag", storeTag(d.Version))
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	WriteJSON(w, status, a)
	return id
}

// deleteApp removes an app and its assignment.
func (s *Server) deleteApp(w http.ResponseWriter, r *http.Request, expected uint64) string {
	id := r.PathValue("id")
	if !noBody(w, r) {
		return id
	}
	d, err := s.store.Update(expected, func(d *store.Data) error {
		if _, ok := d.Apps[id]; !ok {
			return errNotFound
		}
		delete(d.Apps, id)
		delete(d.Assignments.PerApp, id)
		return nil
	})
	if !s.updated(w, r, err) {
		return id
	}
	s.checks.forget(id)
	w.Header().Set("ETag", storeTag(d.Version))
	w.WriteHeader(http.StatusNoContent)
	return id
}

func (s *Server) lastCheck(w http.ResponseWriter, r *http.Request, _ Identity) {
	id := r.PathValue("id")
	if _, ok := s.store.Snapshot().Apps[id]; !ok {
		Problem(w, r, http.StatusNotFound, "not_found", "No such app.")
		return
	}
	var last *Check
	if ch, ok := s.checks.get(id); ok {
		last = &ch
	}
	WriteJSON(w, http.StatusOK, map[string]any{"app": id, "lastCheck": last})
}

// --- assignments ---

var assignmentFields = map[string][]string{"": {"global", "perApp"}}

type assignmentsBody struct {
	Global *string           `json:"global"`
	PerApp map[string]string `json:"perApp"`
}

func (s *Server) getAssignments(w http.ResponseWriter, r *http.Request, _ Identity) {
	d := s.store.Snapshot()
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, d.Assignments)
}

// putAssignments replaces all assignments. Both fields are required; an
// app left out of perApp inherits the global default.
func (s *Server) putAssignments(w http.ResponseWriter, r *http.Request, expected uint64) string {
	body, ok := readBody(w, r, maxOtherBody)
	if !ok {
		return ""
	}
	var in assignmentsBody
	if err := strictjson.Decode(body, &in, assignmentFields); err != nil {
		Problem(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return ""
	}
	if !hasKeys(body, "global", "perApp") {
		Problem(w, r, http.StatusUnprocessableEntity, "missing_field", "Send both global (a theme id or null) and perApp.")
		return ""
	}
	if in.PerApp == nil {
		in.PerApp = map[string]string{}
	}
	d, err := s.store.Update(expected, func(d *store.Data) error {
		d.Assignments = store.Assignments{Global: in.Global, PerApp: in.PerApp}
		return nil
	})
	if !s.updated(w, r, err) {
		return ""
	}
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, d.Assignments)
	return ""
}

// --- favourites ---

var favouriteFields = map[string][]string{"": {"favourites"}}

func (s *Server) getFavourites(w http.ResponseWriter, r *http.Request, _ Identity) {
	d := s.store.Snapshot()
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, map[string]any{"favourites": d.Favourites})
}

func (s *Server) putFavourites(w http.ResponseWriter, r *http.Request, expected uint64) string {
	body, ok := readBody(w, r, maxOtherBody)
	if !ok {
		return ""
	}
	var in struct {
		Favourites []string `json:"favourites"`
	}
	if err := strictjson.Decode(body, &in, favouriteFields); err != nil {
		Problem(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return ""
	}
	if in.Favourites == nil {
		Problem(w, r, http.StatusUnprocessableEntity, "missing_field", "Send favourites, a list of theme ids.")
		return ""
	}
	d, err := s.store.Update(expected, func(d *store.Data) error {
		d.Favourites = in.Favourites
		return nil
	})
	if !s.updated(w, r, err) {
		return ""
	}
	w.Header().Set("ETag", storeTag(d.Version))
	WriteJSON(w, http.StatusOK, map[string]any{"favourites": d.Favourites})
	return ""
}

// hasKeys reports whether the top object of a body (already checked by
// strictjson) has every key named.
func hasKeys(body []byte, keys ...string) bool {
	var top map[string]any
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
