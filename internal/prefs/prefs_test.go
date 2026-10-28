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
