// Package themetest builds valid theme documents for tests, from the
// embedded manifest, so tests don't hard-code the token list.
package themetest

import (
	"encoding/json"

	"github.com/Coolroo/themarr/internal/theme"
)

// Doc is a theme document as a generic JSON value, for tests to change.
type Doc = map[string]any

// Colour is the DTCG colour token for r, g, b in 0..255.
func Colour(r, g, b int) map[string]any {
	hex := func(v int) string {
		const digits = "0123456789abcdef"
		return string([]byte{digits[v>>4], digits[v&15]})
	}
	return map[string]any{"$type": "color", "$value": map[string]any{
		"colorSpace": "srgb",
		"components": []float64{float64(r) / 255, float64(g) / 255, float64(b) / 255},
		"hex":        "#" + hex(r) + hex(g) + hex(b),
	}}
}

// Valid is a valid hand-made theme with every token the manifest lists
// (required and optional) in each mode (light and dark when none given).
func Valid(id string, modes ...string) Doc {
	if len(modes) == 0 {
		modes = []string{"light", "dark"}
	}
	tokens := map[string]any{}
	for i, mode := range modes {
		set := map[string]any{}
		for j, s := range theme.Default().Specs() {
			if s.Kind == theme.KindDimension {
				set[s.Name] = map[string]any{"$type": "dimension", "$value": map[string]any{"value": 0.5, "unit": "rem"}}
			} else {
				set[s.Name] = Colour((j*7)%256, (j*13+i*50)%256, (j*29)%256)
			}
		}
		tokens[mode] = set
	}
	ms := make([]any, len(modes))
	for i, m := range modes {
		ms[i] = m
	}
	return Doc{"id": id, "name": "Theme " + id, "version": 1, "source": map[string]any{"kind": "handmade"}, "modes": ms, "tokens": tokens}
}

// Seeded is Valid with a seeded source.
func Seeded(id string) Doc {
	d := Valid(id)
	d["source"] = map[string]any{"kind": "seeded", "seeds": map[string]any{"primary": "#3366ff"}, "schemeStyle": "tonal", "contrast": 0}
	return d
}

// JSON encodes d.
func JSON(d Doc) []byte {
	b, err := json.Marshal(d)
	if err != nil {
		panic(err)
	}
	return b
}
