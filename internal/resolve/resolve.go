// Package resolve picks the theme one person gets in one app (decision
// 0007). The answer is the first layer, top down, that decides:
//
//  1. Enforced: an admin's enforced policy for the person, else for one of
//     their groups. Nothing below can change it; the answer is Locked.
//  2. (Local override: in the browser only. The SDK applies it unless the
//     answer is Locked; the server never sees it.)
//  3. Saved: the person's own choice for this app.
//  4. Default: an admin's default policy for the person, else for one of
//     their groups.
//  5. App: the app's assignment (a theme, or "none": no theme, and the
//     layers below are not asked), then Global: the global default.
//  6. Nothing: the app keeps its own look.
//
// Each layer is one function (a Layer) in Layers; adding or removing a
// layer touches only that list and its function. A layer that names a theme
// that no longer exists does not decide: the next candidate, then the next
// layer, is asked.
//
// Conflicts inside a layer: the person's own policy beats any group
// policy; among group policies of the same kind, the group whose name
// sorts first (byte order) wins. Layers come first: a group's enforced
// policy beats the person's own default.
package resolve

import (
	"sort"

	"github.com/Coolroo/themarr/internal/identity"
	"github.com/Coolroo/themarr/internal/prefs"
	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
)

// Source says which layer decided.
type Source string

const (
	FromEnforced Source = "enforced"
	FromSaved    Source = "saved"
	FromDefault  Source = "default"
	FromApp      Source = "app"
	FromGlobal   Source = "global"
	FromNothing  Source = "" // no layer set a theme
)

// Input is everything a resolution reads: one snapshot of each file, who
// is asking (nil: nobody, as on the public route), and the app.
type Input struct {
	Data  *store.Data
	Prefs *prefs.Data // nil: no saved choices and no policies
	Who   *identity.Identity
	App   string
}

// Resolution is the theme the app gets, and where it came from. Theme is
// nil when no theme applies: the app keeps its own look. Locked means an
// admin enforced it: the SDK must ignore the person's local override.
type Resolution struct {
	Theme  *theme.Theme
	Source Source
	Locked bool
}

// Layer is one layer: it decides (ok), or passes to the next layer.
type Layer func(in Input) (res Resolution, ok bool)

// Layers are asked in this order.
var Layers = []Layer{Enforced, Saved, Default, App, Global}

// Resolve asks each layer in turn; nothing decides means no theme.
func Resolve(in Input) Resolution {
	for _, layer := range Layers {
		if res, ok := layer(in); ok {
			return res
		}
	}
	return Resolution{}
}

// Public is the resolution without a person: the app's assignment, then
// the global default. It is the public route's resolver.
func Public(d *store.Data, app string) Resolution {
	return Resolve(Input{Data: d, App: app})
}

// Enforced is layer 1: an enforced policy for the person, else for their
// first group by name.
func Enforced(in Input) (Resolution, bool) {
	if t := policyTheme(in, prefs.Enforced); t != nil {
		return Resolution{Theme: t, Source: FromEnforced, Locked: true}, true
	}
	return Resolution{}, false
}

// Saved is layer 3: the person's own choice for this app.
func Saved(in Input) (Resolution, bool) {
	if in.Prefs == nil || in.Who == nil {
		return Resolution{}, false
	}
	if id, ok := in.Prefs.Choice(in.Who.User, in.App); ok {
		if t := in.Data.Themes[id]; t != nil {
			return Resolution{Theme: t, Source: FromSaved}, true
		}
	}
	return Resolution{}, false
}

// Default is layer 4: a default policy for the person, else for their
// first group by name.
func Default(in Input) (Resolution, bool) {
	if t := policyTheme(in, prefs.Default); t != nil {
		return Resolution{Theme: t, Source: FromDefault}, true
	}
	return Resolution{}, false
}

// App is layer 5a: the app's own assignment. "none" decides with no theme;
// "inherit", no entry, or a missing theme passes to Global.
func App(in Input) (Resolution, bool) {
	v, ok := in.Data.Assignments.PerApp[in.App]
	if !ok || v == store.Inherit {
		return Resolution{}, false
	}
	if v == store.None {
		return Resolution{}, true
	}
	if t := in.Data.Themes[v]; t != nil {
		return Resolution{Theme: t, Source: FromApp}, true
	}
	return Resolution{}, false
}

// Global is layer 5b: the global default.
func Global(in Input) (Resolution, bool) {
	if g := in.Data.Assignments.Global; g != nil {
		if t := in.Data.Themes[*g]; t != nil {
			return Resolution{Theme: t, Source: FromGlobal}, true
		}
	}
	return Resolution{}, false
}

// policyTheme is the theme of the first policy of kind that applies to the
// person and names an existing theme: the person's own, then their groups'
// in name order.
func policyTheme(in Input, kind prefs.Kind) *theme.Theme {
	if in.Prefs == nil || in.Who == nil {
		return nil
	}
	if p, ok := in.Prefs.Users[in.Who.User]; ok && p.Kind == kind {
		if t := in.Data.Themes[p.Theme]; t != nil {
			return t
		}
	}
	groups := append([]string{}, in.Who.Groups...)
	sort.Strings(groups)
	for _, g := range groups {
		if p, ok := in.Prefs.Groups[g]; ok && p.Kind == kind {
			if t := in.Data.Themes[p.Theme]; t != nil {
				return t
			}
		}
	}
	return nil
}
