// Package store keeps themarr's data: themes, apps, assignments and
// favourites, in one JSON file in the data directory.
//
// Every write names the version it read (the HTTP layer's If-Match) and
// fails with ErrConflict when the store has moved on. A write builds a new
// snapshot, writes it to a temp file in the same directory, syncs it,
// renames it over the store file and syncs the directory, and only then
// becomes what readers see. Readers take the current snapshot without
// waiting; a snapshot is never changed after it is published.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/Coolroo/themarr/internal/strictjson"
	"github.com/Coolroo/themarr/internal/theme"
)

// FileName is the store file in the data directory.
const FileName = "themarr.json"

// format is the file's layout version; a file with another one is refused.
const format = 1

// Limits keep the file small: themarr holds the homelab's themes, not a
// catalogue.
const (
	MaxThemes     = 500
	MaxApps       = 200
	MaxOrigins    = 10
	MaxFavourites = MaxThemes
)

// Assignment values other than a theme id.
const (
	Inherit = "inherit" // use the global default (the same as no entry)
	None    = "none"    // no theme: the app keeps its own defaults
)

// App is an app that takes its theme from themarr.
type App struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Origins []string `json:"origins"`
}

// Assignments say which theme each app gets.
type Assignments struct {
	Global *string           `json:"global"` // a theme id, or null for none
	PerApp map[string]string `json:"perApp"` // app id -> theme id, "inherit" or "none"
}

// Data is one snapshot of the store. Its maps and slices are never changed
// after the snapshot is published; a write replaces them.
type Data struct {
	Version     uint64                  `json:"version"`
	Themes      map[string]*theme.Theme `json:"themes"`
	Apps        map[string]App          `json:"apps"`
	Assignments Assignments             `json:"assignments"`
	Favourites  []string                `json:"favourites"`
}

// ErrConflict means the expected version is not the store's.
var ErrConflict = errors.New("store: the version has changed")

// Store is the data file and its current snapshot.
type Store struct {
	path     string
	manifest *theme.Manifest
	mu       sync.Mutex // one writer at a time
	cur      atomic.Pointer[Data]
}

// Open loads the store file in dir, or starts empty (version 0) when there
// is none. A file that can't be read, parsed or checked is an error: themarr
// refuses to start rather than overwrite data it doesn't understand.
func Open(dir string, m *theme.Manifest) (*Store, error) {
	s := &Store{path: filepath.Join(dir, FileName), manifest: m}
	b, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		s.cur.Store(empty())
		return s, nil
	case err != nil:
		return nil, fmt.Errorf("store %s: %w", s.path, err)
	}
	d, err := decode(b, m)
	if err != nil {
		return nil, fmt.Errorf("store %s: %w (the file is left as it is)", s.path, err)
	}
	s.cur.Store(d)
	return s, nil
}

func empty() *Data {
	return &Data{Themes: map[string]*theme.Theme{}, Apps: map[string]App{}, Assignments: Assignments{PerApp: map[string]string{}}, Favourites: []string{}}
}

// Snapshot is the current data. Callers must not change it.
func (s *Store) Snapshot() *Data {
	return s.cur.Load()
}

// Update applies fn to a copy of the current data, if the store is at
// version expected, and saves the result as version expected+1. fn changes
// the copy only by replacing map entries and fields, never by editing a
// value it read. An error from fn, or a copy that breaks the store's rules
// (Check), leaves the store as it was.
func (s *Store) Update(expected uint64, fn func(d *Data) error) (*Data, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.cur.Load()
	if cur.Version != expected {
		return nil, ErrConflict
	}
	next := cur.clone()
	if err := fn(next); err != nil {
		return nil, err
	}
	if err := next.Check(); err != nil {
		return nil, err
	}
	next.Version = cur.Version + 1
	if err := s.save(next); err != nil {
		if IsRenamed(err) {
			// The file was renamed into place but the rename may not survive
			// a crash. What is on disk is the new data, so readers see it too;
			// the caller still gets the error.
			s.cur.Store(next)
		}
		return nil, err
	}
	s.cur.Store(next)
	return next, nil
}

// dirSyncError is a save whose rename succeeded but whose directory sync
// failed.
type dirSyncError struct{ err error }

func (e *dirSyncError) Error() string { return "store: sync dir: " + e.err.Error() }
func (e *dirSyncError) Unwrap() error { return e.err }

// clone copies the maps and slices one level deep. Their values (themes,
// apps) are shared: they are never changed in place.
func (d *Data) clone() *Data {
	n := &Data{Version: d.Version, Themes: make(map[string]*theme.Theme, len(d.Themes)), Apps: make(map[string]App, len(d.Apps)),
		Assignments: Assignments{Global: d.Assignments.Global, PerApp: make(map[string]string, len(d.Assignments.PerApp))},
		Favourites:  append([]string{}, d.Favourites...)}
	for k, v := range d.Themes {
		n.Themes[k] = v
	}
	for k, v := range d.Apps {
		n.Apps[k] = v
	}
	for k, v := range d.Assignments.PerApp {
		n.Assignments.PerApp[k] = v
	}
	return n
}

// RuleError is a write that would break one of the store's rules, such as an
// assignment naming a missing theme. Code is stable (docs/contract.md).
type RuleError struct {
	Code   string
	Detail string
}

func (e *RuleError) Error() string { return e.Detail }

func rule(code, format string, args ...any) error {
	return &RuleError{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// Check enforces the rules every snapshot keeps: ids match their keys,
// assignments and favourites name themes and apps that exist, and the limits
// hold.
func (d *Data) Check() error {
	if len(d.Themes) > MaxThemes {
		return rule("too_many", "at most %d themes", MaxThemes)
	}
	if len(d.Apps) > MaxApps {
		return rule("too_many", "at most %d apps", MaxApps)
	}
	for id, t := range d.Themes {
		if t == nil || t.ID != id {
			return rule("invalid", "theme %q is stored under another id", id)
		}
	}
	for id, a := range d.Apps {
		if a.ID != id || !theme.ValidSlug(id) {
			return rule("invalid", "app %q is stored under another id", id)
		}
		if err := CheckApp(a); err != nil {
			return err
		}
	}
	if g := d.Assignments.Global; g != nil {
		if _, ok := d.Themes[*g]; !ok {
			return rule("unknown_theme", "the global default names theme %q, which doesn't exist", *g)
		}
	}
	for app, v := range d.Assignments.PerApp {
		if _, ok := d.Apps[app]; !ok {
			return rule("unknown_app", "an assignment names app %q, which doesn't exist", app)
		}
		if v == Inherit || v == None {
			continue
		}
		if _, ok := d.Themes[v]; !ok {
			return rule("unknown_theme", "app %q is assigned theme %q, which doesn't exist", app, v)
		}
	}
	if len(d.Favourites) > MaxFavourites {
		return rule("too_many", "at most %d favourites", MaxFavourites)
	}
	seen := map[string]bool{}
	for _, f := range d.Favourites {
		if _, ok := d.Themes[f]; !ok {
			return rule("unknown_theme", "favourite %q is not a theme", f)
		}
		if seen[f] {
			return rule("invalid", "favourite %q is listed twice", f)
		}
		seen[f] = true
	}
	return nil
}

// CheckApp checks one app's fields: a name and https origins as browsers
// send them.
func CheckApp(a App) error {
	if !theme.ValidSlug(a.ID) {
		return rule("invalid", "the app id must be 1-64 lower-case letters, digits and inner hyphens, not inherit or none")
	}
	if r := []rune(a.Name); len(r) == 0 || len(r) > 80 || !printable(a.Name) {
		return rule("invalid", "the app name must be 1-80 printable characters")
	}
	if len(a.Origins) > MaxOrigins {
		return rule("invalid", "at most %d origins", MaxOrigins)
	}
	seen := map[string]bool{}
	for _, o := range a.Origins {
		if !ValidOrigin(o) {
			return rule("invalid", "each origin must be https://host[:port] as a browser sends it: a lower-case host name, a port of 1-65535 but not 443, no path")
		}
		if seen[o] {
			return rule("invalid", "an origin is listed twice")
		}
		seen[o] = true
	}
	return nil
}

// originPattern is an https origin as a browser sends it: a lower-case DNS
// host name (labels of letters, digits and inner hyphens) and an optional
// port without leading zeros.
var originPattern = regexp.MustCompile(`^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$`)

// ValidOrigin accepts exactly an https origin as a browser sends it in the
// Origin header: lower-case host name, an optional port of 1-65535 other
// than 443 (a browser leaves the default port out), no path, no trailing
// slash. It is the strict pattern the drawer's frame-ancestors check uses,
// so nothing else (a wildcard, quotes, ";", non-ASCII, an empty port) can
// be stored and then go into a header (T-115).
func ValidOrigin(o string) bool {
	if len(o) > 255 || !originPattern.MatchString(o) {
		return false
	}
	if i := strings.LastIndexByte(o, ':'); i > len("https:") {
		port, err := strconv.Atoi(o[i+1:])
		if err != nil || port > 65535 || port == 443 {
			return false
		}
	}
	return true
}

func printable(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0) {
			return false
		}
	}
	return true
}

// file is the store file's layout. Themes stay raw so each is parsed and
// checked by the manifest, exactly as a PUT would be.
type file struct {
	Format      int                        `json:"format"`
	Version     uint64                     `json:"version"`
	Themes      map[string]json.RawMessage `json:"themes"`
	Apps        map[string]App             `json:"apps"`
	Assignments Assignments                `json:"assignments"`
	Favourites  []string                   `json:"favourites"`
}

var fileFields = map[string][]string{
	"":            {"format", "version", "themes", "apps", "assignments", "favourites"},
	"assignments": {"global", "perApp"},
}

func decode(b []byte, m *theme.Manifest) (*Data, error) {
	var f file
	if err := strictjson.Decode(b, &f, fileFields); err != nil {
		return nil, err
	}
	if f.Format != format {
		return nil, fmt.Errorf("format %d, want %d", f.Format, format)
	}
	d := empty()
	d.Version = f.Version
	for id, raw := range f.Themes {
		t, err := m.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("theme %q: %w", id, err)
		}
		d.Themes[id] = t
	}
	for id, a := range f.Apps {
		if a.Origins == nil {
			a.Origins = []string{}
		}
		d.Apps[id] = a
	}
	d.Assignments.Global = f.Assignments.Global
	for k, v := range f.Assignments.PerApp {
		d.Assignments.PerApp[k] = v
	}
	if f.Favourites != nil {
		d.Favourites = f.Favourites
	}
	if err := d.Check(); err != nil {
		return nil, err
	}
	return d, nil
}

func encode(d *Data) ([]byte, error) {
	f := file{Format: format, Version: d.Version, Themes: map[string]json.RawMessage{}, Apps: d.Apps,
		Assignments: d.Assignments, Favourites: d.Favourites}
	for id, t := range d.Themes {
		b, err := json.Marshal(t)
		if err != nil {
			return nil, err
		}
		f.Themes[id] = b
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// save writes d atomically with WriteAtomic.
func (s *Store) save(d *Data) error {
	b, err := encode(d)
	if err != nil {
		return fmt.Errorf("store: encode: %w", err)
	}
	return WriteAtomic(s.path, b)
}

// WriteAtomic replaces the file at path with b: a temp file in the same
// directory (a rename across file systems fails, and the root file system
// is read-only), synced, renamed over path, and the directory synced so the
// rename itself survives a crash. When only that last sync fails, the
// error satisfies IsRenamed: the new content is in place, but the rename
// may not survive a crash. internal/prefs writes its file with it too.
func WriteAtomic(path string, b []byte) (err error) {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("store: temp file: %w", err)
	}
	defer func() {
		if err != nil {
			os.Remove(tmp.Name())
		}
	}()
	if _, err = tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("store: write: %w", err)
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("store: sync: %w", err)
	}
	if err = tmp.Close(); err != nil {
		return fmt.Errorf("store: close: %w", err)
	}
	if err = os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("store: rename: %w", err)
	}
	// The temp name is gone now (renamed); on an error below, the deferred
	// Remove finds nothing to remove.
	dh, derr := os.Open(dir)
	if derr != nil {
		return &dirSyncError{derr}
	}
	defer dh.Close()
	if derr = dh.Sync(); derr != nil {
		return &dirSyncError{derr}
	}
	return nil
}

// IsRenamed reports whether err is from a WriteAtomic whose rename
// succeeded but whose directory sync failed: the file holds the new
// content.
func IsRenamed(err error) bool {
	var synced *dirSyncError
	return errors.As(err, &synced)
}

// ThemeIDs lists the themes' ids in order.
func (d *Data) ThemeIDs() []string { return sortedKeys(d.Themes) }

// AppIDs lists the apps' ids in order.
func (d *Data) AppIDs() []string { return sortedKeys(d.Apps) }

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
