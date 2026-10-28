package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/Coolroo/themarr/internal/store"
	"github.com/Coolroo/themarr/internal/theme"
)

// CatalogEntry is one theme in the public catalog (decision 0009): what a
// drawer needs to show a tile. Never the source, seeds or assignments.
type CatalogEntry struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Version int64             `json:"version"`
	Modes   []string          `json:"modes"`
	Swatch  map[string]Swatch `json:"swatch"`
}

// Swatch is the few colours of one mode a tile is drawn with, as
// "#RRGGBB" (upper case, no alpha).
type Swatch struct {
	Primary    string `json:"primary"`
	Background string `json:"background"`
	Foreground string `json:"foreground"`
	Tag        string `json:"tag,omitempty"`
}

// Catalog is the body of GET /v1/catalog.
type Catalog struct {
	Themes     []CatalogEntry `json:"themes"`
	Favourites []string       `json:"favourites"`
}

// buildCatalog lists every theme of one snapshot, sorted by name (case
// folded), then by id.
func buildCatalog(d *store.Data) Catalog {
	c := Catalog{Themes: make([]CatalogEntry, 0, len(d.Themes)), Favourites: []string{}}
	for _, t := range d.Themes {
		c.Themes = append(c.Themes, catalogEntry(t))
	}
	sort.Slice(c.Themes, func(i, j int) bool {
		a, b := strings.ToLower(c.Themes[i].Name), strings.ToLower(c.Themes[j].Name)
		if a != b {
			return a < b
		}
		return c.Themes[i].ID < c.Themes[j].ID
	})
	for _, id := range d.Favourites {
		if d.Themes[id] != nil {
			c.Favourites = append(c.Favourites, id)
		}
	}
	return c
}

func catalogEntry(t *theme.Theme) CatalogEntry {
	e := CatalogEntry{ID: t.ID, Name: t.Name, Version: t.Version, Modes: append([]string{}, t.Modes...), Swatch: map[string]Swatch{}}
	for _, mode := range t.Modes {
		set := t.Tokens[mode]
		e.Swatch[mode] = Swatch{
			Primary:    swatchHex(set, "primary"),
			Background: swatchHex(set, "background"),
			Foreground: swatchHex(set, "foreground"),
			Tag:        swatchHex(set, "tag"),
		}
	}
	return e
}

// swatchHex is a colour token's hex in upper case, or "" when the token is
// missing (only the optional tag can be).
func swatchHex(set map[string]theme.Token, name string) string {
	tok, ok := set[name]
	if !ok || tok.Color == nil {
		return ""
	}
	return strings.ToUpper(tok.Color.Hex)
}

// catalog serves GET|HEAD /v1/catalog: every theme's id, name, version,
// modes and a few colours per mode, for the SDK's drawer (decision 0009).
// The ETag is a hash of the body, so it changes exactly when the body does.
func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	var buf bytes.Buffer
	// Strings, integers and maps of strings: encoding can't fail.
	json.NewEncoder(&buf).Encode(buildCatalog(s.store.Snapshot()))
	sum := sha256.Sum256(buf.Bytes())
	tag := `"c` + hex.EncodeToString(sum[:12]) + `"`
	w.Header().Set("ETag", tag)
	if noneMatch(r.Header.Values("If-None-Match"), tag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(buf.Bytes())
	}
}
