package store

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/Coolroo/themarr/internal/theme"
	"github.com/Coolroo/themarr/internal/theme/themetest"
)

func open(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir, theme.Default())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func mustTheme(t *testing.T, id string) *theme.Theme {
	t.Helper()
	th, err := theme.Default().Parse(themetest.JSON(themetest.Valid(id)))
	if err != nil {
		t.Fatal(err)
	}
	return th
}

func encoded(t *testing.T, d *Data) []byte {
	t.Helper()
	b, err := encode(d)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestEmptyStart(t *testing.T) {
	s := open(t, t.TempDir())
	d := s.Snapshot()
	if d.Version != 0 || len(d.Themes) != 0 || len(d.Apps) != 0 || d.Assignments.Global != nil {
		t.Fatalf("empty store %+v", d)
	}
}

// TestWriteAndReload: a write bumps the version, lands in the file, and a
// new Open reads back exactly what was written.
func TestWriteAndReload(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	th := mustTheme(t, "ocean")
	d, err := s.Update(0, func(d *Data) error {
		d.Themes["ocean"] = th
		d.Apps["board"] = App{ID: "board", Name: "Board", Origins: []string{"https://board.coolroo.dev"}}
		g := "ocean"
		d.Assignments.Global = &g
		d.Assignments.PerApp["board"] = None
		d.Favourites = []string{"ocean"}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if d.Version != 1 || s.Snapshot() != d {
		t.Fatalf("version %d", d.Version)
	}
	again := open(t, dir)
	if !bytes.Equal(encoded(t, again.Snapshot()), encoded(t, d)) {
		t.Fatalf("reload differs:\n%s\n%s", encoded(t, again.Snapshot()), encoded(t, d))
	}
	fi, err := os.Stat(filepath.Join(dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("file mode %v, want 0600", fi.Mode().Perm())
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("left behind: %v", entries)
	}
}

// TestSnapshotsAreNotChanged: a write never changes a snapshot a reader
// already holds.
func TestSnapshotsAreNotChanged(t *testing.T) {
	s := open(t, t.TempDir())
	before := s.Snapshot()
	if _, err := s.Update(0, func(d *Data) error {
		d.Apps["board"] = App{ID: "board", Name: "Board", Origins: []string{}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(before.Apps) != 0 || before.Version != 0 {
		t.Fatalf("old snapshot changed: %+v", before)
	}
}

func TestStaleVersionConflicts(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	if _, err := s.Update(0, func(*Data) error { return nil }); err != nil {
		t.Fatal(err)
	}
	called := false
	_, err := s.Update(0, func(*Data) error { called = true; return nil })
	if !errors.Is(err, ErrConflict) || called {
		t.Fatalf("stale write: err %v, fn called %v", err, called)
	}
	if _, err := s.Update(7, func(*Data) error { return nil }); !errors.Is(err, ErrConflict) {
		t.Fatalf("future version: %v", err)
	}
	if s.Snapshot().Version != 1 {
		t.Fatalf("version %d", s.Snapshot().Version)
	}
}

func TestFailedWriteChangesNothing(t *testing.T) {
	dir := t.TempDir()
	s := open(t, dir)
	boom := errors.New("boom")
	if _, err := s.Update(0, func(d *Data) error {
		d.Apps["board"] = App{ID: "board", Name: "Board"}
		return boom
	}); !errors.Is(err, boom) {
		t.Fatal(err)
	}
	if len(s.Snapshot().Apps) != 0 || s.Snapshot().Version != 0 {
		t.Fatal("a failed write changed the store")
	}
	if _, err := os.Stat(filepath.Join(dir, FileName)); !os.IsNotExist(err) {
		t.Fatal("a failed write made a file")
	}
}

func TestRulesAreKept(t *testing.T) {
	s := open(t, t.TempDir())
	cases := map[string]struct {
		fn   func(d *Data)
		code string
	}{
		"global to a missing theme": {func(d *Data) { g := "x"; d.Assignments.Global = &g }, "unknown_theme"},
		"app to a missing theme": {func(d *Data) {
			d.Apps["board"] = App{ID: "board", Name: "Board"}
			d.Assignments.PerApp["board"] = "x"
		}, "unknown_theme"},
		"assignment for a missing app": {func(d *Data) { d.Assignments.PerApp["ghost"] = None }, "unknown_app"},
		"favourite missing":            {func(d *Data) { d.Favourites = []string{"x"} }, "unknown_theme"},
		"favourite twice": {func(d *Data) {
			d.Themes["ocean"] = mustTheme(t, "ocean")
			d.Favourites = []string{"ocean", "ocean"}
		}, "invalid"},
		"theme under another id": {func(d *Data) { d.Themes["sea"] = mustTheme(t, "ocean") }, "invalid"},
		"app under another id":   {func(d *Data) { d.Apps["a"] = App{ID: "b", Name: "B"} }, "invalid"},
		"app without name":       {func(d *Data) { d.Apps["a"] = App{ID: "a"} }, "invalid"},
		"app http origin":        {func(d *Data) { d.Apps["a"] = App{ID: "a", Name: "A", Origins: []string{"http://a.test"}} }, "invalid"},
		"too many apps": {func(d *Data) {
			for i := 0; i <= MaxApps; i++ {
				id := "app-" + strconv.Itoa(i)
				d.Apps[id] = App{ID: id, Name: id}
			}
		}, "too_many"},
	}
	for name, c := range cases {
		_, err := s.Update(0, func(d *Data) error { c.fn(d); return nil })
		var re *RuleError
		if !errors.As(err, &re) || re.Code != c.code {
			t.Errorf("%s: err %v, want code %s", name, err, c.code)
		}
	}
	if s.Snapshot().Version != 0 {
		t.Fatal("a refused write changed the version")
	}
}

// TestCorruptFileIsRefusedAndKept: themarr refuses to start on a file it
// can't read, and leaves the file as it was.
func TestCorruptFileIsRefusedAndKept(t *testing.T) {
	valid := func() string {
		dir := t.TempDir()
		s := open(t, dir)
		if _, err := s.Update(0, func(d *Data) error { d.Themes["ocean"] = mustTheme(t, "ocean"); return nil }); err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(filepath.Join(dir, FileName))
		return string(b)
	}()
	for name, content := range map[string]string{
		"garbage":         "not json at all",
		"truncated":       valid[:len(valid)/2],
		"empty":           "",
		"wrong format":    strings.Replace(valid, `"format": 1`, `"format": 2`, 1),
		"unknown field":   strings.Replace(valid, `"format": 1`, `"format": 1, "extra": true`, 1),
		"invalid theme":   strings.Replace(valid, `"colorSpace": "srgb"`, `"colorSpace": "p3"`, 1),
		"dangling global": strings.Replace(valid, `"global": null`, `"global": "gone"`, 1),
	} {
		if content == valid {
			t.Fatalf("%s: the replacement did not apply", name)
		}
		dir := t.TempDir()
		path := filepath.Join(dir, FileName)
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(dir, theme.Default()); err == nil {
			t.Errorf("%s: opened", name)
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
			id := "first-" + strconv.Itoa(i)
			_, err := s.Update(0, func(d *Data) error { d.Apps[id] = App{ID: id, Name: id, Origins: []string{}}; return nil })
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
			id := "app-" + strconv.Itoa(i)
			for {
				v := s.Snapshot().Version
				_, err := s.Update(v, func(d *Data) error { d.Apps[id] = App{ID: id, Name: id, Origins: []string{}}; return nil })
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
	if d.Version != n+1 || len(d.Apps) != n+1 {
		t.Fatalf("version %d, %d apps", d.Version, len(d.Apps))
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
	if _, err := s.Update(0, func(d *Data) error { d.Apps["a"] = App{ID: "a", Name: "A"}; return nil }); err == nil {
		t.Fatal("a write to a read-only directory succeeded")
	}
	if s.Snapshot().Version != 0 || len(s.Snapshot().Apps) != 0 {
		t.Fatal("a failed save changed the snapshot")
	}
}

func TestValidOrigin(t *testing.T) {
	for o, want := range map[string]bool{
		"https://board.coolroo.dev":      true,
		"https://board.coolroo.dev:8443": true,
		"http://board.coolroo.dev":       false,
		"https://board.coolroo.dev/":     false,
		"https://board.coolroo.dev/x":    false,
		"https://Board.coolroo.dev":      false,
		"https://a@board.coolroo.dev":    false,
		"https://board.coolroo.dev?x":    false,
		"https://board.coolroo.dev#x":    false,
		"https://":                       false,
		"board.coolroo.dev":              false,
		"":                               false,
	} {
		if ValidOrigin(o) != want {
			t.Errorf("ValidOrigin(%q) = %v", o, !want)
		}
	}
	// T-115 review: what the old check let through, and the edges of the
	// strict pattern.
	for _, o := range []string{
		"https://localhost", "https://a", "https://x-1.y-2.test:1", "https://board.test:65535",
		"https://10.0.0.1:8443",
	} {
		if !ValidOrigin(o) {
			t.Errorf("ValidOrigin(%q) = false", o)
		}
	}
	for _, o := range []string{
		"https://*.coolroo.dev", "https://a;b", `https://a"b`, "https://a'b", "https://h:",
		"https://bôard.test", "https://board.test:0", "https://board.test:08443", "https://board.test:65536",
		"https://board.test:99999", "https://board.test:443", "https://-a.test", "https://a-.test",
		"https://a..test", "https://.a.test", "https://a.test.", "https://a_b.test", "https://[::1]",
		"https://a b.test", "https://a.test:80:81", "https://a.test\n", "HTTPS://a.test",
		"https://" + strings.Repeat("a", 250),
	} {
		if ValidOrigin(o) {
			t.Errorf("ValidOrigin(%q) = true", o)
		}
	}
}
