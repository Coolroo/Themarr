// Package theme is a theme's shape and its validation against the token
// manifest. The validator is a port of packages/tokens/src/validate.ts
// (T-116) and gives the same codes at the same JSON Pointer paths; the tests
// run that package's golden fixtures. The server never makes tokens: it
// checks what the admin UI sends and stores it.
package theme

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Coolroo/themarr/internal/strictjson"
)

// Theme is a stored theme. A Theme is never changed once built: the store
// replaces a theme, it doesn't edit one.
type Theme struct {
	ID      string                      `json:"id"`
	Name    string                      `json:"name"`
	Version int64                       `json:"version"`
	Source  Source                      `json:"source"`
	Modes   []string                    `json:"modes"`
	Tokens  map[string]map[string]Token `json:"tokens"`
}

// Source says how a theme was made: "seeded" (Material, from seed colours)
// or "handmade".
type Source struct {
	Kind        string   `json:"kind"`
	Seeds       *Seeds   `json:"seeds,omitempty"`
	SchemeStyle string   `json:"schemeStyle,omitempty"`
	Contrast    *float64 `json:"contrast,omitempty"`
}

// Seeds are the colours a seeded theme was made from, as "#rrggbb".
type Seeds struct {
	Primary string `json:"primary"`
	Tag     string `json:"tag,omitempty"`
}

// Token is one DTCG design token: a colour or a dimension.
type Token struct {
	Color     *Color
	Dimension *Dimension
}

// Color is a DTCG colour value in sRGB.
type Color struct {
	ColorSpace string     `json:"colorSpace"`
	Components [3]float64 `json:"components"`
	Hex        string     `json:"hex"`
	Alpha      *float64   `json:"alpha,omitempty"`
}

// Dimension is a DTCG dimension value.
type Dimension struct {
	Value float64 `json:"value"`
	Unit  string  `json:"unit"`
}

// MarshalJSON writes the DTCG form: {"$type": ..., "$value": ...}.
func (t Token) MarshalJSON() ([]byte, error) {
	if t.Color != nil {
		return json.Marshal(struct {
			Type  string `json:"$type"`
			Value *Color `json:"$value"`
		}{string(KindColor), t.Color})
	}
	return json.Marshal(struct {
		Type  string     `json:"$type"`
		Value *Dimension `json:"$value"`
	}{string(KindDimension), t.Dimension})
}

// Public is all the public routes show of a theme (decision 0004): its
// tokens for its modes, its modes, and its version. Never its id, name or
// source.
type Public struct {
	Version int64                       `json:"version"`
	Modes   []string                    `json:"modes"`
	Tokens  map[string]map[string]Token `json:"tokens"`
}

// Public returns the public view of t.
func (t *Theme) Public() Public {
	return Public{Version: t.Version, Modes: t.Modes, Tokens: t.Tokens}
}

// Issue is one validation failure: a stable code (the manifest's
// errorCodes), a JSON Pointer (RFC 6901) to the value, "" for the whole
// theme, and a message for people. Messages may change; codes and paths
// don't.
type Issue struct {
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Invalid is a theme document that parsed as JSON but broke the rules.
type Invalid struct {
	Issues []Issue
}

func (e *Invalid) Error() string {
	parts := make([]string, len(e.Issues))
	for i, is := range e.Issues {
		parts[i] = fmt.Sprintf("%s at %q: %s", is.Code, is.Path, is.Message)
	}
	return strings.Join(parts, "; ")
}

// ErrJSON wraps a document that is not acceptable JSON at all: malformed,
// repeated keys, invalid UTF-8, too deep, or something after the object.
// (JSON.parse would take the last of two repeated keys; themarr refuses.)
var ErrJSON = errors.New("theme: not acceptable JSON")

// The issue codes, as the manifest lists them.
const (
	CodeNotObject             = "not_object"
	CodeMissingField          = "missing_field"
	CodeUnknownField          = "unknown_field"
	CodeBadType               = "bad_type"
	CodeBadID                 = "bad_id"
	CodeBadName               = "bad_name"
	CodeBadVersion            = "bad_version"
	CodeBadSourceKind         = "bad_source_kind"
	CodeMissingSeed           = "missing_seed"
	CodeBadSchemeStyle        = "bad_scheme_style"
	CodeBadContrast           = "bad_contrast"
	CodeEmptyModes            = "empty_modes"
	CodeBadMode               = "bad_mode"
	CodeDuplicateMode         = "duplicate_mode"
	CodeModeWithoutTokens     = "mode_without_tokens"
	CodeTokensForUnlistedMode = "tokens_for_unlisted_mode"
	CodeMissingToken          = "missing_token"
	CodeUnknownToken          = "unknown_token"
	CodeBadTokenType          = "bad_token_type"
	CodeBadColorSpace         = "bad_color_space"
	CodeBadComponents         = "bad_components"
	CodeBadHex                = "bad_hex"
	CodeHexMismatch           = "hex_mismatch"
	CodeBadAlpha              = "bad_alpha"
	CodeBadDimension          = "bad_dimension"
	CodeBadUnit               = "bad_unit"
)

var allCodes = []string{CodeNotObject, CodeMissingField, CodeUnknownField, CodeBadType, CodeBadID, CodeBadName,
	CodeBadVersion, CodeBadSourceKind, CodeMissingSeed, CodeBadSchemeStyle, CodeBadContrast, CodeEmptyModes, CodeBadMode,
	CodeDuplicateMode, CodeModeWithoutTokens, CodeTokensForUnlistedMode, CodeMissingToken, CodeUnknownToken,
	CodeBadTokenType, CodeBadColorSpace, CodeBadComponents, CodeBadHex, CodeHexMismatch, CodeBadAlpha, CodeBadDimension,
	CodeBadUnit}

// maxSafeInteger is JavaScript's Number.MAX_SAFE_INTEGER, 2^53-1.
const maxSafeInteger = 1<<53 - 1

// ValidID reports whether s is an id the manifest allows (idPattern, at
// most idMaxLength characters). The server also reserves "inherit" and
// "none" (see ValidSlug).
func (m *Manifest) ValidID(s string) bool {
	return len(s) <= m.Limits.IDMaxLength && m.idRE.MatchString(s)
}

// ValidSlug is the id rule for themes and apps in the store: the
// manifest's id rule, and not one of the words an assignment uses
// ("inherit", "none").
func ValidSlug(s string) bool {
	return defaultManifest.ValidID(s) && s != "inherit" && s != "none"
}

// Parse reads one theme document and checks it against the manifest. The
// error is ErrJSON (wrapped) for unacceptable JSON, or *Invalid with every
// issue found.
func (m *Manifest) Parse(data []byte) (*Theme, error) {
	if !utf8.Valid(data) {
		return nil, fmt.Errorf("%w: invalid UTF-8", ErrJSON)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var x any
	if err := dec.Decode(&x); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrJSON, err.Error())
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, fmt.Errorf("%w: something follows the value", ErrJSON)
	}
	v := &validator{m: m}
	if _, isObj := x.(map[string]any); !isObj {
		// Valid JSON, but not an object: a validation issue, as in validate.ts.
		v.theme(x)
		return nil, &Invalid{Issues: v.issues}
	}
	// Repeated keys (JSON.parse would keep the last) and nesting depth.
	if err := strictjson.CheckKeys(data, nil); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrJSON, err.Error())
	}
	v.theme(x)
	if len(v.issues) > 0 {
		return nil, &Invalid{Issues: v.issues}
	}
	return build(x.(map[string]any)), nil
}

type validator struct {
	m      *Manifest
	issues []Issue
}

func (v *validator) add(code, path, format string, args ...any) {
	v.issues = append(v.issues, Issue{Code: code, Path: path, Message: fmt.Sprintf(format, args...)})
}

// ptr appends one reference token to a JSON Pointer, escaped.
func ptr(base string, key any) string {
	s := fmt.Sprint(key)
	return base + "/" + strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
}

func typeName(x any) string {
	switch x.(type) {
	case nil:
		return "null"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	case string:
		return "string"
	case bool:
		return "boolean"
	default:
		return "number"
	}
}

// num is x as a JavaScript number would see it: ok when x is a JSON number;
// finite false when it overflows a float64.
func num(x any) (f float64, ok, finite bool) {
	n, isNum := x.(json.Number)
	if !isNum {
		return 0, false, false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return f, true, false
	}
	return f, true, true
}

func has(obj map[string]any, k string) bool {
	_, ok := obj[k]
	return ok
}

// fields reports fields of obj not allowed, and required fields absent. It
// returns false when a required field is absent.
func (v *validator) fields(obj map[string]any, path string, required []string, optional ...string) bool {
	for _, k := range sortedKeys(obj) {
		if !contains(required, k) && !contains(optional, k) {
			v.add(CodeUnknownField, ptr(path, k), "field %s is not allowed here", quote(k))
		}
	}
	all := true
	for _, k := range required {
		if !has(obj, k) {
			v.add(CodeMissingField, ptr(path, k), "field %s is required", quote(k))
			all = false
		}
	}
	return all
}

func (v *validator) theme(x any) {
	obj, ok := x.(map[string]any)
	if !ok {
		v.add(CodeNotObject, "", "a theme must be an object, got %s", typeName(x))
		return
	}
	v.fields(obj, "", []string{"id", "name", "version", "source", "modes", "tokens"})
	if id, present := obj["id"]; present {
		s, isStr := id.(string)
		if !isStr || !v.m.ValidID(s) {
			v.add(CodeBadID, "/id", "id must be lower-case letters, digits and single hyphens, at most %d characters", v.m.Limits.IDMaxLength)
		}
	}
	if name, present := obj["name"]; present {
		s, isStr := name.(string)
		if !isStr || !v.validName(s) {
			v.add(CodeBadName, "/name", "name must be 1-%d characters, not blank, without control characters", v.m.Limits.NameMaxLength)
		}
	}
	if ver, present := obj["version"]; present {
		f, isNum, finite := num(ver)
		if !isNum || !finite || f != math.Trunc(f) || f < 1 || f > maxSafeInteger {
			v.add(CodeBadVersion, "/version", "version must be an integer >= 1")
		}
	}
	if src, present := obj["source"]; present {
		v.source(src, "/source")
	}
	var listed map[string]bool
	if modes, present := obj["modes"]; present {
		listed = v.modes(modes, "/modes")
	}
	if toks, present := obj["tokens"]; present {
		v.tokens(toks, "/tokens", listed)
	}
}

// validName: 1 to nameMaxLength code points, none in U+0000-U+001F or
// U+007F, at least one that JavaScript's \s doesn't match.
func (v *validator) validName(s string) bool {
	if utf8.RuneCountInString(s) > v.m.Limits.NameMaxLength {
		return false
	}
	visible := false
	for _, r := range s {
		if r <= 0x1f || r == 0x7f {
			return false
		}
		if !jsSpace(r) {
			visible = true
		}
	}
	return visible
}

// jsSpace is ECMAScript's \s: WhiteSpace and LineTerminator.
func jsSpace(r rune) bool {
	switch r {
	case '\t', '\v', '\f', ' ', 0xa0, 0xfeff, '\n', '\r', 0x2028, 0x2029:
		return true
	}
	return unicode.Is(unicode.Zs, r)
}

func (v *validator) hex(x any, path string) (string, bool) {
	s, ok := x.(string)
	if !ok {
		v.add(CodeBadType, path, "expected a string, got %s", typeName(x))
		return "", false
	}
	if !v.m.hexRE.MatchString(s) {
		v.add(CodeBadHex, path, "%s is not a #rrggbb colour", quote(s))
		return "", false
	}
	return s, true
}

func (v *validator) source(x any, path string) {
	obj, ok := x.(map[string]any)
	if !ok {
		v.add(CodeNotObject, path, "source must be an object, got %s", typeName(x))
		return
	}
	if !has(obj, "kind") {
		v.add(CodeMissingField, ptr(path, "kind"), "field \"kind\" is required")
		return
	}
	kind := obj["kind"]
	if kind == "handmade" {
		v.fields(obj, path, []string{"kind"})
		return
	}
	if kind != "seeded" {
		v.add(CodeBadSourceKind, ptr(path, "kind"), "kind must be one of %s", strings.Join(v.m.SourceKinds, ", "))
		return
	}
	v.fields(obj, path, []string{"kind", "seeds", "schemeStyle", "contrast"})
	if seeds, present := obj["seeds"]; present {
		sp := ptr(path, "seeds")
		so, isObj := seeds.(map[string]any)
		if !isObj {
			v.add(CodeNotObject, sp, "seeds must be an object, got %s", typeName(seeds))
		} else {
			for _, k := range sortedKeys(so) {
				if k != "primary" && k != "tag" {
					v.add(CodeUnknownField, ptr(sp, k), "seed %s is not allowed", quote(k))
				}
			}
			if !has(so, "primary") {
				v.add(CodeMissingSeed, ptr(sp, "primary"), "a seeded theme needs a primary seed")
			} else {
				v.hex(so["primary"], ptr(sp, "primary"))
			}
			if has(so, "tag") {
				v.hex(so["tag"], ptr(sp, "tag"))
			}
		}
	}
	if style, present := obj["schemeStyle"]; present {
		s, isStr := style.(string)
		if !isStr || !contains(v.m.SchemeStyles, s) {
			v.add(CodeBadSchemeStyle, ptr(path, "schemeStyle"), "schemeStyle must be one of %s", strings.Join(v.m.SchemeStyles, ", "))
		}
	}
	if c, present := obj["contrast"]; present {
		f, isNum, finite := num(c)
		if !isNum || !finite || !contains(v.m.ContrastLevels, f) {
			v.add(CodeBadContrast, ptr(path, "contrast"), "contrast must be one of the manifest's contrast levels")
		}
	}
}

// modes returns the valid, unique listed modes, or nil when modes is not
// an array.
func (v *validator) modes(x any, path string) map[string]bool {
	list, ok := x.([]any)
	if !ok {
		v.add(CodeBadType, path, "modes must be an array, got %s", typeName(x))
		return nil
	}
	listed := map[string]bool{}
	if len(list) == 0 {
		v.add(CodeEmptyModes, path, "modes must list at least one mode")
	}
	for i, item := range list {
		p := ptr(path, i)
		s, isStr := item.(string)
		switch {
		case !isStr || !contains(v.m.Modes, s):
			v.add(CodeBadMode, p, "mode must be one of %s", strings.Join(v.m.Modes, ", "))
		case listed[s]:
			v.add(CodeDuplicateMode, p, "mode %s is listed twice", quote(s))
		default:
			listed[s] = true
		}
	}
	return listed
}

// tokens checks the tokens object; listed is nil when modes is absent or
// not an array, and then only the modes present are checked.
func (v *validator) tokens(x any, path string, listed map[string]bool) {
	obj, ok := x.(map[string]any)
	if !ok {
		v.add(CodeNotObject, path, "tokens must be an object, got %s", typeName(x))
		return
	}
	for _, k := range sortedKeys(obj) {
		if listed == nil {
			if !contains(v.m.Modes, k) {
				v.add(CodeTokensForUnlistedMode, ptr(path, k), "%s is not a mode", quote(k))
			}
		} else if !listed[k] {
			v.add(CodeTokensForUnlistedMode, ptr(path, k), "tokens has %s, which modes does not list", quote(k))
		}
	}
	for _, mode := range v.m.Modes {
		if listed == nil {
			if has(obj, mode) {
				v.modeTokens(obj[mode], ptr(path, mode))
			}
			continue
		}
		if !listed[mode] {
			continue
		}
		if !has(obj, mode) {
			v.add(CodeModeWithoutTokens, ptr(path, mode), "mode %s is listed but has no tokens", quote(mode))
			continue
		}
		v.modeTokens(obj[mode], ptr(path, mode))
	}
}

func (v *validator) modeTokens(x any, path string) {
	obj, ok := x.(map[string]any)
	if !ok {
		v.add(CodeNotObject, path, "a mode's tokens must be an object, got %s", typeName(x))
		return
	}
	for _, name := range sortedKeys(obj) {
		p := ptr(path, name)
		spec, known := v.m.specs[name]
		if !known {
			v.add(CodeUnknownToken, p, "%s is not a themarr token", quote(name))
			continue
		}
		tok, isObj := obj[name].(map[string]any)
		if !isObj {
			v.add(CodeNotObject, p, "token must be an object, got %s", typeName(obj[name]))
			continue
		}
		if !v.fields(tok, p, []string{"$type", "$value"}) {
			continue
		}
		if tok["$type"] != string(spec.Kind) {
			v.add(CodeBadTokenType, ptr(p, "$type"), "%s must have $type %q", quote(name), spec.Kind)
			continue
		}
		if spec.Kind == KindColor {
			v.colorValue(tok["$value"], ptr(p, "$value"))
		} else {
			v.dimensionValue(tok["$value"], ptr(p, "$value"))
		}
	}
	for _, spec := range v.m.Tokens {
		if spec.Required && !has(obj, spec.Name) {
			v.add(CodeMissingToken, ptr(path, spec.Name), "required token %s is missing", quote(spec.Name))
		}
	}
}

func (v *validator) colorValue(x any, path string) {
	obj, ok := x.(map[string]any)
	if !ok {
		v.add(CodeNotObject, path, "$value must be an object, got %s", typeName(x))
		return
	}
	v.fields(obj, path, []string{"colorSpace", "components", "hex"}, "alpha")
	if cs, present := obj["colorSpace"]; present && cs != "srgb" {
		v.add(CodeBadColorSpace, ptr(path, "colorSpace"), "colorSpace must be \"srgb\"")
	}
	var comps []float64
	if raw, present := obj["components"]; present {
		list, isList := raw.([]any)
		good := isList && len(list) == 3
		var vals []float64
		for _, item := range list {
			f, isNum, finite := num(item)
			if !isNum || !finite || f < 0 || f > 1 {
				good = false
			}
			vals = append(vals, f)
		}
		if good {
			comps = vals
		} else {
			v.add(CodeBadComponents, ptr(path, "components"), "components must be three numbers in 0..1")
		}
	}
	var hex string
	hexOK := false
	if raw, present := obj["hex"]; present {
		hex, hexOK = v.hex(raw, ptr(path, "hex"))
	}
	if comps != nil && hexOK {
		for i := 0; i < 3; i++ {
			b, _ := strconv.ParseUint(hex[1+2*i:3+2*i], 16, 8)
			if math.Abs(comps[i]*255-float64(b)) > v.m.Limits.HexTolerance+1e-9 {
				v.add(CodeHexMismatch, ptr(path, "hex"), "hex %s does not match the components", hex)
				break
			}
		}
	}
	if a, present := obj["alpha"]; present {
		f, isNum, finite := num(a)
		if !isNum || !finite || f < 0 || f > 1 {
			v.add(CodeBadAlpha, ptr(path, "alpha"), "alpha must be a number in 0..1")
		}
	}
}

func (v *validator) dimensionValue(x any, path string) {
	obj, ok := x.(map[string]any)
	if !ok {
		v.add(CodeNotObject, path, "$value must be an object, got %s", typeName(x))
		return
	}
	v.fields(obj, path, []string{"value", "unit"})
	if n, present := obj["value"]; present {
		f, isNum, finite := num(n)
		if !isNum || !finite || f < 0 {
			v.add(CodeBadDimension, ptr(path, "value"), "value must be a finite number >= 0")
		}
	}
	if u, present := obj["unit"]; present {
		s, isStr := u.(string)
		if !isStr || !contains(v.m.DimensionUnits, s) {
			v.add(CodeBadUnit, ptr(path, "unit"), "unit must be one of %s", strings.Join(v.m.DimensionUnits, ", "))
		}
	}
}

// build turns a validated document into a Theme. Every assertion here holds
// because the validator found no issue.
func build(obj map[string]any) *Theme {
	f := func(x any) float64 {
		n, _, _ := num(x)
		return n
	}
	t := &Theme{
		ID:      obj["id"].(string),
		Name:    obj["name"].(string),
		Version: int64(f(obj["version"])),
		Tokens:  map[string]map[string]Token{},
	}
	src := obj["source"].(map[string]any)
	t.Source.Kind = src["kind"].(string)
	if t.Source.Kind == "seeded" {
		seeds := src["seeds"].(map[string]any)
		t.Source.Seeds = &Seeds{Primary: seeds["primary"].(string)}
		if tag, ok := seeds["tag"].(string); ok {
			t.Source.Seeds.Tag = tag
		}
		t.Source.SchemeStyle = src["schemeStyle"].(string)
		c := f(src["contrast"])
		t.Source.Contrast = &c
	}
	for _, m := range obj["modes"].([]any) {
		t.Modes = append(t.Modes, m.(string))
	}
	for mode, set := range obj["tokens"].(map[string]any) {
		out := map[string]Token{}
		for name, raw := range set.(map[string]any) {
			tok := raw.(map[string]any)
			val := tok["$value"].(map[string]any)
			if tok["$type"] == string(KindDimension) {
				out[name] = Token{Dimension: &Dimension{Value: f(val["value"]), Unit: val["unit"].(string)}}
				continue
			}
			c := &Color{ColorSpace: val["colorSpace"].(string), Hex: val["hex"].(string)}
			for i, comp := range val["components"].([]any) {
				c.Components[i] = f(comp)
			}
			if a, ok := val["alpha"]; ok {
				av := f(a)
				c.Alpha = &av
			}
			out[name] = Token{Color: c}
		}
		t.Tokens[mode] = out
	}
	return t
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// quote names a key or value from the document, bounded so a huge one
// can't fill the answer.
func quote(s string) string {
	if r := []rune(s); len(r) > 40 {
		s = string(r[:40]) + "..."
	}
	b, _ := json.Marshal(s)
	return string(b)
}
