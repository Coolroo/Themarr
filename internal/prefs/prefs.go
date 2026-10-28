// Package prefs keeps what people and admins choose, apart from the themes
// themselves (internal/store): each user's saved theme for each app, and
// the admins' user and group policies. Who a user is, and which groups
// they are in, comes from internal/identity; this package stores names
// only.
//
// It follows internal/store's rules (decision 0007): one JSON file in the
// data directory, prefs.json; every write names the version it read and
// fails with ErrConflict when the part it changes (the policies, or one
// person's choice for one app: Part) has changed since; a write that
// changes nothing is not written; a write builds a new
// snapshot, writes it with store.WriteAtomic (temp file in the same
// directory, fsync, rename, fsync of the directory), and only then
// becomes what readers see. Readers take the current snapshot without
// waiting. A file that can't be read stops the start and is left as it is.
//
// Theme ids here may name a theme deleted later (a saved choice, or a
// policy written while the theme was being deleted): the resolver skips
// them (internal/resolve). Deleting a theme that a policy names is refused
// (Store.ThemeInUse); a saved choice never blocks a delete.
package prefs

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"

	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/strictjson"
	"github.com/Coolroo/themarr/internal/theme"
)

// FileName is the prefs file in the data directory.
const FileName = "prefs.json"

// format is the file's layout version; a file with another one is refused.
const format = 1

// Limits keep the file small.
const (
	MaxUsers    = 1000          // users with saved choices
	MaxChoices  = store.MaxApps // saved choices per user
	MaxPolicies = 1000          // policies per scope
)

// Kind is how a policy applies.
type Kind string

const (
	// Default is a theme the person may change (layer 4).
	Default Kind = "default"
	// Enforced is a theme nothing below can change (layer 1): the person's
	// saved choice and local override are ignored.
	Enforced Kind = "enforced"
)

// Valid reports whether k is one of the two kinds.
func (k Kind) Valid() bool { return k == Default || k == Enforced }

// Policy is an admin's theme for a user or a group, for every app.
type Policy struct {
	Theme string `json:"theme"`
	Kind  Kind   `json:"kind"`
}

// Scope is whom a policy names.
type Scope string

const (
	Users  Scope = "users"
	Groups Scope = "groups"
)

// Data is one snapshot. Its maps are never changed after the snapshot is
// published; inside Update, change it only with its Set and Delete methods,
// which replace what they change.
type Data struct {
	Version uint64
	Choices map[string]map[string]string // user -> app -> theme id
	Users   map[string]Policy            // user name -> policy
	Groups  map[string]Policy            // group name -> policy
}

// ErrConflict means the expected version is not the file's.
var ErrConflict = errors.New("prefs: the version has changed")

func empty() *Data {
	return &Data{Choices: map[string]map[string]string{}, Users: map[string]Policy{}, Groups: map[string]Policy{}}
}

// Choice is user's saved theme for app.
func (d *Data) Choice(user, app string) (string, bool) {
	t, ok := d.Choices[user][app]
	return t, ok
}

// Policies is the map of one scope. Callers must not change it.
func (d *Data) Policies(s Scope) map[string]Policy {
	if s == Groups {
		return d.Groups
	}
	return d.Users
}

// SetChoice saves user's theme for app; an empty themeID clears it.
func (d *Data) SetChoice(user, app, themeID string) {
	next := make(map[string]string, len(d.Choices[user])+1)
	for k, v := range d.Choices[user] {
		next[k] = v
	}
	if themeID == "" {
		delete(next, app)
	} else {
		next[app] = themeID
	}
	if len(next) == 0 {
		delete(d.Choices, user)
		return
	}
	d.Choices[user] = next
}

// SetPolicy sets the policy for name in scope s.
func (d *Data) SetPolicy(s Scope, name string, p Policy) {
	d.Policies(s)[name] = p
}

// DeletePolicy removes the policy for name, and reports whether there was
// one.
func (d *Data) DeletePolicy(s Scope, name string) bool {
	m := d.Policies(s)
	_, ok := m[name]
	delete(m, name)
	return ok
}

// NamesTheme reports whether any policy names theme id.
func (d *Data) NamesTheme(id string) bool {
	for _, m := range []map[string]Policy{d.Users, d.Groups} {
		for _, p := range m {
			if p.Theme == id {
				return true
			}
		}
	}
	return false
}

// Names lists a scope's names in order.
func (d *Data) Names(s Scope) []string {
	m := d.Policies(s)
	names := make([]string, 0, len(m))
	for k := range m {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

func (d *Data) clone() *Data {
	n := &Data{Version: d.Version, Choices: make(map[string]map[string]string, len(d.Choices)),
		Users: make(map[string]Policy, len(d.Users)), Groups: make(map[string]Policy, len(d.Groups))}
	for k, v := range d.Choices {
		n.Choices[k] = v // shared: SetChoice replaces, never edits
	}
	for k, v := range d.Users {
		n.Users[k] = v
	}
	for k, v := range d.Groups {
		n.Groups[k] = v
	}
	return n
}

func rule(code, format string, args ...any) error {
	return &store.RuleError{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// Check enforces the rules every snapshot keeps: names and ids in shape,
// policy kinds known, and the limits. It does not ask whether a theme
// exists (see the package comment).
func (d *Data) Check() error {
	if len(d.Choices) > MaxUsers {
		return rule("too_many", "at most %d users with saved choices", MaxUsers)
	}
	for user, apps := range d.Choices {
		if !identity.ValidName(user) {
			return rule("invalid", "a saved choice names a user that is not a valid name")
		}
		if len(apps) > MaxChoices {
			return rule("too_many", "at most %d saved choices per user", MaxChoices)
		}
		for app, t := range apps {
			if !theme.ValidSlug(app) || !theme.ValidSlug(t) {
				return rule("invalid", "a saved choice names an app or theme that is not a valid id")
			}
		}
	}
	for _, s := range []Scope{Users, Groups} {
		m := d.Policies(s)
		if len(m) > MaxPolicies {
			return rule("too_many", "at most %d %s policies", MaxPolicies, s[:len(s)-1])
		}
		for name, p := range m {
			if !identity.ValidName(name) {
				return rule("invalid", "a policy names a %s that is not a valid name", s[:len(s)-1])
			}
			if !theme.ValidSlug(p.Theme) {
				return rule("invalid", "a policy's theme must be a theme id")
			}
			if !p.Kind.Valid() {
				return rule("invalid", `a policy's kind must be "default" or "enforced"`)
			}
		}
	}
	return nil
}

// Store is the prefs file and its current snapshot.
type Store struct {
	path string
	mu   sync.Mutex // one writer at a time
	cur  atomic.Pointer[Data]

	// Under mu: the version at which each part last changed, in memory
	// only. A choice not in choiceAt last changed at base or before; base
	// starts as the file's version, so after a restart every older tag
	// conflicts once.
	base       uint64
	policiesAt uint64
	choiceAt   map[choiceKey]uint64
}

// A Part is what one write changes, for the version check: the policies,
// one person's saved choice for one app, or the whole file. A write names
// the prefs version it read (If-Match) and conflicts only when its own part
// changed after that version, so one person's saves never make an admin's
// policy write, or another person's save, fail with 412 (T-115).
type Part struct {
	kind      partKind
	user, app string
}

type partKind uint8

const (
	partAll partKind = iota
	partPolicies
	partChoice
)

var (
	// All is the whole file: any change after the version read conflicts.
	All = Part{kind: partAll}
	// PolicyPart is the user and group policies, all together.
	PolicyPart = Part{kind: partPolicies}
)

// ChoiceOf is user's saved choice for app.
func ChoiceOf(user, app string) Part { return Part{kind: partChoice, user: user, app: app} }

type choiceKey struct{ user, app string }

// maxTracked bounds the versions kept per saved choice. Above it they are
// dropped and every choice counts as changed at that version: a stale tag
// then conflicts once more than it must.
const maxTracked = 10000

// Open loads the prefs file in dir, or starts empty (version 0) when there
// is none. A file that can't be read, parsed or checked is an error. Temp
// files a crashed write left behind are removed first.
func Open(dir string) (*Store, error) {
	s := &Store{path: filepath.Join(dir, FileName), choiceAt: map[choiceKey]uint64{}}
	if err := store.RemoveStaleTemps(s.path); err != nil {
		return nil, fmt.Errorf("prefs %s: %w", s.path, err)
	}
	b, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		s.cur.Store(empty())
		return s, nil
	case err != nil:
		return nil, fmt.Errorf("prefs %s: %w", s.path, err)
	}
	d, err := decode(b)
	if err != nil {
		return nil, fmt.Errorf("prefs %s: %w (the file is left as it is)", s.path, err)
	}
	s.cur.Store(d)
	s.base, s.policiesAt = d.Version, d.Version
	return s, nil
}

// Snapshot is the current data. Callers must not change it.
func (s *Store) Snapshot() *Data { return s.cur.Load() }

// ThemeInUse reports whether a policy names theme id (for the server's
// theme delete).
func (s *Store) ThemeInUse(id string) bool { return s.Snapshot().NamesTheme(id) }

// Update is UpdatePart for the whole file: it conflicts unless the file is
// still at version expected.
func (s *Store) Update(expected uint64, fn func(d *Data) error) (*Data, error) {
	d, _, err := s.UpdatePart(expected, All, fn)
	return d, err
}

// UpdatePart applies fn to a copy of the current data and saves the result
// as the next version, unless part changed after version expected (or
// expected is newer than the file): then ErrConflict. fn changes only
// part, and only with Data's Set and Delete methods. An error from fn, or
// a copy that breaks Check, leaves everything as it was. A copy that
// changes nothing is not written: UpdatePart returns the current data,
// written is false, and the version stays.
func (s *Store) UpdatePart(expected uint64, p Part, fn func(d *Data) error) (d *Data, written bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.cur.Load()
	if expected > cur.Version || expected < s.changedAt(p, cur) {
		return nil, false, ErrConflict
	}
	next := cur.clone()
	if err := fn(next); err != nil {
		return nil, false, err
	}
	return s.commit(cur, next, p)
}

// DropChoices removes every saved choice for an app that keep refuses (an
// app no longer registered), so a deleted app's choices neither count to
// the limits nor come back when an app with that id is registered again.
// It reports how many it removed; when there are none, nothing is written.
func (s *Store) DropChoices(keep func(app string) bool) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.cur.Load()
	next := cur.clone()
	n := 0
	for user, apps := range cur.Choices {
		for app := range apps {
			if !keep(app) {
				next.SetChoice(user, app, "")
				n++
			}
		}
	}
	if _, _, err := s.commit(cur, next, All); err != nil {
		return 0, err
	}
	return n, nil
}

// changedAt is the version at which part last changed (under mu).
func (s *Store) changedAt(p Part, cur *Data) uint64 {
	switch p.kind {
	case partPolicies:
		return s.policiesAt
	case partChoice:
		if v, ok := s.choiceAt[choiceKey{p.user, p.app}]; ok {
			return v
		}
		return s.base
	default:
		return cur.Version
	}
}

// commit saves next as the version after cur, unless nothing in part
// changed (under mu).
func (s *Store) commit(cur, next *Data, p Part) (*Data, bool, error) {
	ch := changes(cur, next, p)
	if !ch.policies && len(ch.choices) == 0 {
		return cur, false, nil
	}
	if err := next.Check(); err != nil {
		return nil, false, err
	}
	next.Version = cur.Version + 1
	b, err := encode(next)
	if err != nil {
		return nil, false, fmt.Errorf("prefs: encode: %w", err)
	}
	if err := store.WriteAtomic(s.path, b); err != nil {
		if store.IsRenamed(err) {
			// The new file is in place; readers see what is on disk.
			s.publish(next, ch)
		}
		return nil, false, err
	}
	s.publish(next, ch)
	return next, true, nil
}

// publish makes next what readers see and notes which parts changed
// (under mu).
func (s *Store) publish(next *Data, ch changed) {
	s.cur.Store(next)
	if ch.policies {
		s.policiesAt = next.Version
	}
	if len(s.choiceAt)+len(ch.choices) > maxTracked {
		s.choiceAt = map[choiceKey]uint64{}
		s.base = next.Version
	}
	for _, k := range ch.choices {
		s.choiceAt[k] = next.Version
	}
}

// changed is what one write changed.
type changed struct {
	policies bool
	choices  []choiceKey
}

// changes compares cur and next in part p (everything for All).
func changes(cur, next *Data, p Part) changed {
	var ch changed
	if p.kind != partChoice {
		ch.policies = !maps.Equal(cur.Users, next.Users) || !maps.Equal(cur.Groups, next.Groups)
	}
	if p.kind == partPolicies {
		return ch
	}
	users := map[string]bool{}
	if p.kind == partChoice {
		users[p.user] = true
	} else {
		for u := range cur.Choices {
			users[u] = true
		}
		for u := range next.Choices {
			users[u] = true
		}
	}
	for u := range users {
		a, b := cur.Choices[u], next.Choices[u]
		for app, t := range a {
			if v, ok := b[app]; !ok || v != t {
				ch.choices = append(ch.choices, choiceKey{u, app})
			}
		}
		for app := range b {
			if _, ok := a[app]; !ok {
				ch.choices = append(ch.choices, choiceKey{u, app})
			}
		}
	}
	return ch
}

// file is the prefs file's layout.
type file struct {
	Format   int                          `json:"format"`
	Version  uint64                       `json:"version"`
	Choices  map[string]map[string]string `json:"choices"`
	Policies filePolicies                 `json:"policies"`
}

type filePolicies struct {
	Users  map[string]Policy `json:"users"`
	Groups map[string]Policy `json:"groups"`
}

var fileFields = map[string][]string{
	"":         {"format", "version", "choices", "policies"},
	"policies": {"users", "groups"},
}

func decode(b []byte) (*Data, error) {
	var f file
	if err := strictjson.Decode(b, &f, fileFields); err != nil {
		return nil, err
	}
	if f.Format != format {
		return nil, fmt.Errorf("format %d, want %d", f.Format, format)
	}
	d := empty()
	d.Version = f.Version
	for user, apps := range f.Choices {
		if len(apps) > 0 {
			d.Choices[user] = apps
		}
	}
	for k, v := range f.Policies.Users {
		d.Users[k] = v
	}
	for k, v := range f.Policies.Groups {
		d.Groups[k] = v
	}
	if err := d.Check(); err != nil {
		return nil, err
	}
	return d, nil
}

func encode(d *Data) ([]byte, error) {
	f := file{Format: format, Version: d.Version, Choices: d.Choices,
		Policies: filePolicies{Users: d.Users, Groups: d.Groups}}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}
