package resolve

import (
	"testing"

	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/prefs"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
)

// data is a store snapshot with the named themes; global "" is none.
func data(global string, perApp map[string]string, themes ...string) *store.Data {
	d := &store.Data{Themes: map[string]*theme.Theme{}, Apps: map[string]store.App{},
		Assignments: store.Assignments{PerApp: map[string]string{}}}
	for _, id := range themes {
		d.Themes[id] = &theme.Theme{ID: id, Version: 1}
	}
	if global != "" {
		d.Assignments.Global = &global
	}
	for k, v := range perApp {
		d.Assignments.PerApp[k] = v
	}
	return d
}

func newPrefs() *prefs.Data {
	return &prefs.Data{Choices: map[string]map[string]string{}, Users: map[string]prefs.Policy{}, Groups: map[string]prefs.Policy{}}
}

func who(user string, groups ...string) *identity.Identity {
	return &identity.Identity{User: user, Groups: groups}
}

func check(t *testing.T, name string, got Resolution, theme string, src Source, locked bool) {
	t.Helper()
	id := ""
	if got.Theme != nil {
		id = got.Theme.ID
	}
	if id != theme || got.Source != src || got.Locked != locked {
		t.Errorf("%s: got %q from %q locked %v, want %q from %q locked %v", name, id, got.Source, got.Locked, theme, src, locked)
	}
}

// TestPrecedence peels the layers off one at a time, top down.
func TestPrecedence(t *testing.T) {
	d := data("glob", map[string]string{"board": "appt"}, "glob", "appt", "dflt", "saved", "enf")
	p := newPrefs()
	p.Users["alice"] = prefs.Policy{Theme: "enf", Kind: prefs.Enforced}
	p.Groups["family"] = prefs.Policy{Theme: "dflt", Kind: prefs.Default}
	p.Choices["alice"] = map[string]string{"board": "saved"}
	in := Input{Data: d, Prefs: p, Who: who("alice", "family"), App: "board"}

	check(t, "enforced", Resolve(in), "enf", FromEnforced, true)
	delete(p.Users, "alice")
	check(t, "saved", Resolve(in), "saved", FromSaved, false)
	delete(p.Choices, "alice")
	check(t, "default", Resolve(in), "dflt", FromDefault, false)
	delete(p.Groups, "family")
	check(t, "app", Resolve(in), "appt", FromApp, false)
	delete(d.Assignments.PerApp, "board")
	check(t, "global", Resolve(in), "glob", FromGlobal, false)
	d.Assignments.Global = nil
	check(t, "nothing", Resolve(in), "", FromNothing, false)
}

func TestSavedBeatsDefaultButNotEnforced(t *testing.T) {
	d := data("", nil, "a", "b")
	p := newPrefs()
	p.Choices["alice"] = map[string]string{"board": "a"}
	p.Users["alice"] = prefs.Policy{Theme: "b", Kind: prefs.Default}
	in := Input{Data: d, Prefs: p, Who: who("alice"), App: "board"}
	check(t, "user default", Resolve(in), "a", FromSaved, false)
	p.Groups["family"] = prefs.Policy{Theme: "b", Kind: prefs.Enforced}
	in.Who = who("alice", "family")
	check(t, "group enforced", Resolve(in), "b", FromEnforced, true)
	// The saved choice is for one app only.
	in.App = "seerr"
	check(t, "other app", Resolve(in), "b", FromEnforced, true)
	p.Groups = map[string]prefs.Policy{}
	check(t, "other app, user default", Resolve(in), "b", FromDefault, false)
}

func TestUserPolicyBeatsGroupPolicy(t *testing.T) {
	d := data("", nil, "mine", "theirs")
	for _, kind := range []prefs.Kind{prefs.Enforced, prefs.Default} {
		p := newPrefs()
		p.Users["alice"] = prefs.Policy{Theme: "mine", Kind: kind}
		p.Groups["aaa"] = prefs.Policy{Theme: "theirs", Kind: kind}
		src := FromDefault
		if kind == prefs.Enforced {
			src = FromEnforced
		}
		check(t, string(kind), Resolve(Input{Data: d, Prefs: p, Who: who("alice", "aaa"), App: "x"}), "mine", src, kind == prefs.Enforced)
	}
}

// TestGroupEnforcedBeatsUserDefault: layers come before user-over-group.
func TestGroupEnforcedBeatsUserDefault(t *testing.T) {
	d := data("", nil, "mine", "theirs")
	p := newPrefs()
	p.Users["alice"] = prefs.Policy{Theme: "mine", Kind: prefs.Default}
	p.Groups["family"] = prefs.Policy{Theme: "theirs", Kind: prefs.Enforced}
	check(t, "", Resolve(Input{Data: d, Prefs: p, Who: who("alice", "family"), App: "x"}), "theirs", FromEnforced, true)
}

// TestGroupPickIsDeterministic: the group whose name sorts first wins,
// whatever order Remote-Groups lists them in.
func TestGroupPickIsDeterministic(t *testing.T) {
	d := data("", nil, "t-alpha", "t-beta", "t-zed")
	for _, kind := range []prefs.Kind{prefs.Enforced, prefs.Default} {
		p := newPrefs()
		p.Groups["beta"] = prefs.Policy{Theme: "t-beta", Kind: kind}
		p.Groups["Zed"] = prefs.Policy{Theme: "t-zed", Kind: kind} // upper case sorts first
		p.Groups["alpha"] = prefs.Policy{Theme: "t-alpha", Kind: kind}
		for _, order := range [][]string{{"alpha", "beta", "Zed"}, {"beta", "Zed", "alpha"}, {"Zed", "alpha", "beta"}} {
			in := Input{Data: d, Prefs: p, Who: who("alice", order...), App: "x"}
			for i := 0; i < 20; i++ {
				if got := Resolve(in); got.Theme == nil || got.Theme.ID != "t-zed" {
					t.Fatalf("%s %v: %+v", kind, order, got)
				}
			}
		}
		// Without Zed, alpha.
		if got := Resolve(Input{Data: d, Prefs: p, Who: who("alice", "beta", "alpha"), App: "x"}); got.Theme.ID != "t-alpha" {
			t.Fatalf("%s: %s", kind, got.Theme.ID)
		}
	}
	// The caller's groups are not reordered in place.
	groups := []string{"b", "a"}
	Resolve(Input{Data: d, Prefs: newPrefs(), Who: &identity.Identity{User: "x", Groups: groups}, App: "x"})
	if groups[0] != "b" {
		t.Fatal("the identity's groups were sorted in place")
	}
}

// TestMissingThemeIsSkipped: a policy or choice naming a deleted theme
// doesn't decide; the next candidate, then the next layer, does.
func TestMissingThemeIsSkipped(t *testing.T) {
	d := data("glob", nil, "glob", "grp")
	p := newPrefs()
	p.Users["alice"] = prefs.Policy{Theme: "gone", Kind: prefs.Enforced}
	p.Groups["a"] = prefs.Policy{Theme: "gone", Kind: prefs.Enforced}
	p.Groups["b"] = prefs.Policy{Theme: "grp", Kind: prefs.Enforced}
	in := Input{Data: d, Prefs: p, Who: who("alice", "a", "b"), App: "board"}
	check(t, "next group", Resolve(in), "grp", FromEnforced, true)
	delete(p.Groups, "b")
	check(t, "next layer", Resolve(in), "glob", FromGlobal, false)
	p.Choices["alice"] = map[string]string{"board": "gone"}
	check(t, "saved gone", Resolve(in), "glob", FromGlobal, false)
	p.Users["alice"] = prefs.Policy{Theme: "gone", Kind: prefs.Default}
	check(t, "default gone", Resolve(in), "glob", FromGlobal, false)
	d.Assignments.PerApp["board"] = "gone" // the store forbids it; skip it anyway
	check(t, "app gone", Resolve(in), "glob", FromGlobal, false)
}

func TestAppNoneStopsAtTheAppLayer(t *testing.T) {
	d := data("glob", map[string]string{"board": store.None, "seerr": store.Inherit}, "glob", "pol")
	check(t, "none", Public(d, "board"), "", FromNothing, false)
	check(t, "inherit", Public(d, "seerr"), "glob", FromGlobal, false)
	check(t, "unknown app", Public(d, "other"), "glob", FromGlobal, false)
	// Policies apply to every app, above the app's assignment.
	p := newPrefs()
	p.Groups["family"] = prefs.Policy{Theme: "pol", Kind: prefs.Default}
	check(t, "policy over none", Resolve(Input{Data: d, Prefs: p, Who: who("bob", "family"), App: "board"}), "pol", FromDefault, false)
}

// TestNobodyGetsOnlyTheAppLayers: without an identity (the public route)
// no policy or choice applies, even one for a user named like nobody.
func TestNobodyGetsOnlyTheAppLayers(t *testing.T) {
	d := data("glob", nil, "glob", "enf")
	p := newPrefs()
	p.Users[""] = prefs.Policy{Theme: "enf", Kind: prefs.Enforced}
	check(t, "no who", Resolve(Input{Data: d, Prefs: p, App: "x"}), "glob", FromGlobal, false)
	check(t, "no prefs", Resolve(Input{Data: d, Who: who("alice"), App: "x"}), "glob", FromGlobal, false)
	// Another user's policy and choices don't apply.
	p.Users["bob"] = prefs.Policy{Theme: "enf", Kind: prefs.Enforced}
	p.Choices["bob"] = map[string]string{"x": "enf"}
	check(t, "other user", Resolve(Input{Data: d, Prefs: p, Who: who("alice"), App: "x"}), "glob", FromGlobal, false)
}

// TestLayersAreIndependent: the list can lose a layer without touching
// the others.
func TestLayersAreIndependent(t *testing.T) {
	saved := Layers
	defer func() { Layers = saved }()
	d := data("glob", nil, "glob", "enf")
	p := newPrefs()
	p.Users["alice"] = prefs.Policy{Theme: "enf", Kind: prefs.Enforced}
	in := Input{Data: d, Prefs: p, Who: who("alice"), App: "x"}
	Layers = []Layer{Saved, Default, App, Global}
	check(t, "without enforced", Resolve(in), "glob", FromGlobal, false)
	Layers = []Layer{Enforced}
	check(t, "enforced only", Resolve(in), "enf", FromEnforced, true)
}
