package prefs

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Coolroo/themarr/internal/store"
)

func open(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestEmptyStart(t *testing.T) {
	s := open(t, t.TempDir())
	d := s.Snapshot()
	if d.Version != 0 || len(d.Choices) != 0 || len(d.Users) != 0 || len(d.Groups) != 0 {
		t.Fatalf("%+v", d)
	}
}

// TestWriteAndReload: a write bumps the version, lands in the file, and a
// new Open reads back exactly what was written.
func TestWriteAndReload(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	d, err := s.Update(0, func(d *Data) error {
		d.SetChoice("alice", "board", "ocean")
		d.SetChoice("alice", "seerr", "forest")
		d.SetPolicy(Users, "bob", Policy{Theme: "ocean", Kind: Enforced})
		d.SetPolicy(Groups, "family", Policy{Theme: "forest", Kind: Default})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if d.Version != 1 || s.Snapshot() != d {
		t.Fatalf("version %d", d.Version)
	}
	again := open(t, dir).Snapshot()
	if !reflect.DeepEqual(again, d) {
		t.Fatalf("reloaded %+v, want %+v", again, d)
	}
	if fi, err := os.Stat(filepath.Join(dir, FileName)); err != nil || fi.Size() == 0 {
		t.Fatal("no file")
	}
	// No temp file is left behind.
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("%d files in the data dir", len(entries))
	}
}

// TestSnapshotsAreNotChanged: a write never changes a snapshot a reader
// holds, the inner maps of saved choices included.
func TestSnapshotsAreNotChanged(t *testing.T) {
	s := open(t, t.TempDir())
	if _, err := s.Update(0, func(d *Data) error { d.SetChoice("alice", "board", "ocean"); return nil }); err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	if _, err := s.Update(1, func(d *Data) error {
		d.SetChoice("alice", "board", "forest")
		d.SetChoice("alice", "seerr", "forest")
		d.SetPolicy(Users, "alice", Policy{Theme: "x", Kind: Default})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if c, _ := before.Choice("alice", "board"); c != "ocean" || len(before.Choices["alice"]) != 1 || len(before.Users) != 0 {
		t.Fatalf("the old snapshot changed: %+v", before)
	}
	// Clearing the last choice removes the user.
	d, err := s.Update(2, func(d *Data) error {
		d.SetChoice("alice", "board", "")
		d.SetChoice("alice", "seerr", "")
		return nil
	})
	if err != nil || len(d.Choices) != 0 {
		t.Fatalf("%v %+v", err, d.Choices)
	}
}

func TestStaleVersionConflicts(t *testing.T) {
	s := open(t, t.TempDir())
	if _, err := s.Update(0, func(d *Data) error { d.SetChoice("a", "b", "c"); return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(0, func(d *Data) error { d.SetChoice("a", "b", "d"); return nil }); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale write: %v", err)
	}
	if c, _ := s.Snapshot().Choice("a", "b"); c != "c" || s.Snapshot().Version != 1 {
		t.Fatal("a stale write changed the data")
	}
}

func TestRulesAreKept(t *testing.T) {
	s := open(t, t.TempDir())
	for name, fn := range map[string]func(d *Data){
		"bad user":    func(d *Data) { d.SetChoice("bad user", "board", "ocean") },
		"bad app":     func(d *Data) { d.SetChoice("alice", "Board", "ocean") },
		"bad theme":   func(d *Data) { d.SetChoice("alice", "board", "none") },
		"bad name":    func(d *Data) { d.SetPolicy(Groups, "a,b", Policy{Theme: "ocean", Kind: Default}) },
		"bad kind":    func(d *Data) { d.SetPolicy(Users, "bob", Policy{Theme: "ocean", Kind: "always"}) },
		"no theme":    func(d *Data) { d.SetPolicy(Users, "bob", Policy{Kind: Default}) },
		"inherit":     func(d *Data) { d.SetPolicy(Users, "bob", Policy{Theme: "inherit", Kind: Default}) },
		"many groups": func(d *Data) { many(d, Groups, MaxPolicies+1) },
		"many users":  func(d *Data) { many(d, Users, MaxPolicies+1) },
		"many choosers": func(d *Data) {
			for i := 0; i <= MaxUsers; i++ {
				d.SetChoice("u"+strconv.Itoa(i), "board", "ocean")
			}
		},
		"many choices": func(d *Data) {
			for i := 0; i <= MaxChoices; i++ {
				d.SetChoice("alice", "app-"+strconv.Itoa(i), "ocean")
			}
		},
	} {
		_, err := s.Update(0, func(d *Data) error { fn(d); return nil })
		var re *store.RuleError
		if !errors.As(err, &re) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if s.Snapshot().Version != 0 {
		t.Fatal("a refused write changed the version")
	}
	// At the limits is fine.
	if _, err := s.Update(0, func(d *Data) error { many(d, Groups, MaxPolicies); return nil }); err != nil {
		t.Fatal(err)
	}
}

func many(d *Data, s Scope, n int) {
	for i := 0; i < n; i++ {
		d.SetPolicy(s, "n"+strconv.Itoa(i), Policy{Theme: "ocean", Kind: Default})
	}
}

func TestFailedFnChangesNothing(t *testing.T) {
	s := open(t, t.TempDir())
	boom := errors.New("boom")
	if _, err := s.Update(0, func(d *Data) error { d.SetChoice("a", "b", "c"); return boom }); err != boom {
		t.Fatal(err)
	}
	if s.Snapshot().Version != 0 || len(s.Snapshot().Choices) != 0 {
		t.Fatal("changed")
	}
}

func TestNamesThemeAndDelete(t *testing.T) {
	s := open(t, t.TempDir())
	if _, err := s.Update(0, func(d *Data) error {
		d.SetChoice("alice", "board", "saved")
		d.SetPolicy(Users, "bob", Policy{Theme: "byuser", Kind: Default})
		d.SetPolicy(Groups, "family", Policy{Theme: "bygroup", Kind: Enforced})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]bool{"byuser": true, "bygroup": true, "saved": false, "other": false} {
		if s.ThemeInUse(id) != want {
			t.Errorf("%s: %v", id, !want)
		}
	}
	var had, again bool
	d, err := s.Update(1, func(d *Data) error {
		had = d.DeletePolicy(Groups, "family")
		again = d.DeletePolicy(Groups, "family")
		return nil
	})
	if err != nil || !had || again || len(d.Groups) != 0 || s.ThemeInUse("bygroup") {
		t.Fatalf("%v %v %v %+v", err, had, again, d.Groups)
	}
	if got := d.Names(Users); !reflect.DeepEqual(got, []string{"bob"}) {
		t.Fatal(got)
	}
}

func TestCorruptFileIsRefusedAndKept(t *testing.T) {
	valid := func() string {
		dir := t.TempDir()
		s := open(t, dir)
		if _, err := s.Update(0, func(d *Data) error {
			d.SetChoice("alice", "board", "ocean")
			d.SetPolicy(Users, "bob", Policy{Theme: "ocean", Kind: Enforced})
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(filepath.Join(dir, FileName))
		return string(b)
	}()
	for name, content := range map[string]string{
		"garbage":        "not json at all",
		"truncated":      valid[:len(valid)/2],
		"empty":          "",
		"wrong format":   strings.Replace(valid, `"format": 1`, `"format": 2`, 1),
		"unknown field":  strings.Replace(valid, `"format": 1`, `"format": 1, "extra": true`, 1),
		"unknown policy": strings.Replace(valid, `"kind": "enforced"`, `"kind": "enforced", "until": 1`, 1),
		"bad kind":       strings.Replace(valid, `"kind": "enforced"`, `"kind": "always"`, 1),
		"bad user":       strings.Replace(valid, `"alice"`, `"al ice"`, 1),
		"repeated key":   strings.Replace(valid, `"format": 1`, `"format": 1, "format": 1`, 1),
	} {
		if content == valid {
			t.Fatalf("%s: the replacement did not apply", name)
		}
		dir := t.TempDir()
		path := filepath.Join(dir, FileName)
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(dir); err == nil || !strings.Contains(err.Error(), "left as it is") {
			t.Errorf("%s: opened (%v)", name, err)
		}
		after, _ := os.ReadFile(path)
		if string(after) != content {
			t.Errorf("%s: the file was changed", name)
		}
	}
}

// TestConcurrentWrites: of many writers sending the same version, exactly
// one wins; writers that retry on conflict all land, one version each.
func TestConcurrentWrites(t *testing.T) {
	s := open(t, t.TempDir())
	const n = 16
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.Update(0, func(d *Data) error { d.SetChoice("first", "app", "t"+strconv.Itoa(i)); return nil })
			if err == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			} else if !errors.Is(err, ErrConflict) {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d writers won at version 0", wins)
	}
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			user := "user" + strconv.Itoa(i)
			for {
				v := s.Snapshot().Version
				_, err := s.Update(v, func(d *Data) error { d.SetChoice(user, "app", "ocean"); return nil })
				if err == nil {
					return
				}
				if !errors.Is(err, ErrConflict) {
					t.Error(err)
					return
				}
			}
		}(i)
	}
	wg.Wait()
	d := s.Snapshot()
	if d.Version != n+1 || len(d.Choices) != n+1 {
		t.Fatalf("version %d, %d users", d.Version, len(d.Choices))
	}
}

func TestUnwritableDirKeepsTheSnapshot(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	dir := t.TempDir()
	s := open(t, dir)
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(dir, 0o700)
	if _, err := s.Update(0, func(d *Data) error { d.SetChoice("a", "b", "c"); return nil }); err == nil {
		t.Fatal("a write to a read-only directory succeeded")
	}
	if s.Snapshot().Version != 0 || len(s.Snapshot().Choices) != 0 {
		t.Fatal("a failed save changed the snapshot")
	}
}

// TestPartsConflictOnlyWithThemselves (T-115 review): a write conflicts
// only when its own part changed after the version it read: one person's
// choice, or the policies. The whole file (Update) conflicts on any change.
func TestPartsConflictOnlyWithThemselves(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	set := func(user, app, th string) func(d *Data) error {
		return func(d *Data) error { d.SetChoice(user, app, th); return nil }
	}
	pol := func(name string) func(d *Data) error {
		return func(d *Data) error { d.SetPolicy(Users, name, Policy{Theme: "ocean", Kind: Default}); return nil }
	}
	mustPart := func(v uint64, p Part, fn func(d *Data) error) {
		t.Helper()
		if _, _, err := s.UpdatePart(v, p, fn); err != nil {
			t.Fatal(err)
		}
	}
	conflicts := func(v uint64, p Part, fn func(d *Data) error) {
		t.Helper()
		if _, _, err := s.UpdatePart(v, p, fn); !errors.Is(err, ErrConflict) {
			t.Fatalf("got %v, want a conflict", err)
		}
	}
	for i := 0; i < 5; i++ {
		mustPart(s.Snapshot().Version, ChoiceOf("bob", "board"), set("bob", "board", "t"+strconv.Itoa(i)))
	}
	// Read at 0: bob's saves since don't touch these parts.
	mustPart(0, PolicyPart, pol("carol"))
	mustPart(0, ChoiceOf("alice", "board"), set("alice", "board", "ocean"))
	mustPart(0, ChoiceOf("bob", "seerr"), set("bob", "seerr", "ocean"))
	// They do touch these.
	conflicts(0, ChoiceOf("bob", "board"), set("bob", "board", "x"))
	conflicts(5, PolicyPart, pol("dave"))
	conflicts(0, All, set("x", "y", "z"))
	conflicts(s.Snapshot().Version+1, ChoiceOf("new", "board"), set("new", "board", "x"))
	if d := s.Snapshot(); d.Version != 8 || len(d.Users) != 1 || len(d.Choices) != 2 {
		t.Fatalf("%+v", d)
	}
	// After a restart, every tag older than the file conflicts once.
	s = open(t, dir)
	conflicts(7, ChoiceOf("alice", "seerr"), set("alice", "seerr", "x"))
	conflicts(7, PolicyPart, pol("erin"))
	mustPart(8, ChoiceOf("alice", "seerr"), set("alice", "seerr", "x"))
	mustPart(8, PolicyPart, pol("erin"))
}

// TestNoOpUpdateWritesNothing (T-115 review): a write that changes nothing
// keeps the version and does not touch the file.
func TestNoOpUpdateWritesNothing(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if _, err := s.Update(0, func(d *Data) error {
		d.SetChoice("bob", "board", "forest")
		d.SetPolicy(Groups, "kids", Policy{Theme: "night", Kind: Enforced})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, FileName)
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	cur := s.Snapshot()
	for _, c := range []struct {
		p  Part
		fn func(d *Data) error
	}{
		{ChoiceOf("bob", "board"), func(d *Data) error { d.SetChoice("bob", "board", "forest"); return nil }},
		{ChoiceOf("bob", "seerr"), func(d *Data) error { d.SetChoice("bob", "seerr", ""); return nil }},
		{PolicyPart, func(d *Data) error { d.SetPolicy(Groups, "kids", Policy{Theme: "night", Kind: Enforced}); return nil }},
		{All, func(d *Data) error { return nil }},
	} {
		d, written, err := s.UpdatePart(1, c.p, c.fn)
		if err != nil || written || d != cur {
			t.Fatalf("%+v: %v %v", c.p, written, err)
		}
	}
	if fi, err := os.Stat(path); err != nil || !fi.ModTime().Equal(old) {
		t.Fatal("a no-op write touched the file")
	}
}

// TestDropChoices (T-115 review): the choices of apps keep refuses go;
// the rest stay; nothing to drop writes nothing.
func TestDropChoices(t *testing.T) {
	s := open(t, t.TempDir())
	if _, err := s.Update(0, func(d *Data) error {
		d.SetChoice("alice", "board", "ocean")
		d.SetChoice("alice", "seerr", "ocean")
		d.SetChoice("bob", "board", "night")
		d.SetPolicy(Users, "bob", Policy{Theme: "ocean", Kind: Default})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	held := s.Snapshot()
	n, err := s.DropChoices(func(app string) bool { return app != "board" })
	if err != nil || n != 2 {
		t.Fatalf("%d %v", n, err)
	}
	d := s.Snapshot()
	if d.Version != 2 || len(d.Choices) != 1 || d.Choices["alice"]["seerr"] != "ocean" || len(d.Users) != 1 {
		t.Fatalf("%+v", d)
	}
	if len(held.Choices) != 2 || held.Choices["alice"]["board"] != "ocean" {
		t.Fatal("a held snapshot changed")
	}
	// The dropped choices count as changed: a tag older than the drop conflicts.
	if _, _, err := s.UpdatePart(1, ChoiceOf("bob", "board"), func(d *Data) error { d.SetChoice("bob", "board", "x"); return nil }); !errors.Is(err, ErrConflict) {
		t.Fatalf("got %v", err)
	}
	if n, err := s.DropChoices(func(app string) bool { return app != "board" }); err != nil || n != 0 || s.Snapshot().Version != 2 {
		t.Fatalf("second drop: %d %v", n, err)
	}
}

// TestStaleTempFilesAreRemovedAtStart (T-115 review): prefs.json's temp
// files a crashed write left behind go at Open.
func TestStaleTempFilesAreRemovedAtStart(t *testing.T) {
	dir := t.TempDir()
	stale := filepath.Join(dir, ".prefs.json.123.tmp")
	if err := os.WriteFile(stale, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	open(t, dir)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("the stale temp file is still there")
	}
}
