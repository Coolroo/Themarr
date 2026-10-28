package theme_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/Coolroo/themarr/internal/theme"
	"github.com/Coolroo/themarr/internal/theme/themetest"
)

// tokensDir is the T-116 package with the manifest's source and the golden
// fixtures.
var tokensDir = filepath.Join("..", "..", "packages", "tokens")

func issues(t *testing.T, doc []byte) []theme.Issue {
	t.Helper()
	_, err := theme.Default().Parse(doc)
	if err == nil {
		return nil
	}
	var inv *theme.Invalid
	if !errors.As(err, &inv) {
		t.Fatalf("error %v is not *theme.Invalid", err)
	}
	return inv.Issues
}

// TestManifestCopyMatchesSource: the embedded manifest.json is a byte copy
// of packages/tokens/tokens.manifest.json. Copy it again after the tokens
// package regenerates it.
func TestManifestCopyMatchesSource(t *testing.T) {
	src, err := os.ReadFile(filepath.Join(tokensDir, "tokens.manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(src, copied) {
		t.Fatal("internal/theme/manifest.json differs from packages/tokens/tokens.manifest.json: cp packages/tokens/tokens.manifest.json internal/theme/manifest.json")
	}
}

func TestEmbeddedManifest(t *testing.T) {
	m := theme.Default()
	names := map[string]theme.Spec{}
	for _, s := range m.Specs() {
		names[s.Name] = s
	}
	if len(names) != 36 {
		t.Errorf("%d tokens, want 36", len(names))
	}
	for name, s := range names {
		want := name != "tag" && name != "tag-foreground"
		if s.Required != want {
			t.Errorf("%s required %v", name, s.Required)
		}
		if (s.Kind == theme.KindDimension) != (name == "radius") {
			t.Errorf("%s has kind %s", name, s.Kind)
		}
	}
}

// TestValidFixtures: every golden valid theme passes.
func TestValidFixtures(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join(tokensDir, "fixtures", "valid", "*.json"))
	if len(files) == 0 {
		t.Fatal("no valid fixtures")
	}
	for _, f := range files {
		doc, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		th, err := theme.Default().Parse(doc)
		if err != nil {
			t.Errorf("%s: %v", filepath.Base(f), err)
			continue
		}
		var raw struct {
			ID string `json:"id"`
		}
		json.Unmarshal(doc, &raw)
		if th.ID != raw.ID || len(th.Tokens) != len(th.Modes) {
			t.Errorf("%s: parsed %s with %d modes", filepath.Base(f), th.ID, len(th.Modes))
		}
	}
}

// TestInvalidFixtures: every golden invalid theme gives exactly the one
// {code, path} in EXPECTED.json, and EXPECTED.json names every file.
func TestInvalidFixtures(t *testing.T) {
	dir := filepath.Join(tokensDir, "fixtures", "invalid")
	b, err := os.ReadFile(filepath.Join(dir, "EXPECTED.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string]struct{ Code, Path string }
	if err := json.Unmarshal(b, &expected); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	seen := 0
	for _, f := range files {
		name := filepath.Base(f)
		if name == "EXPECTED.json" {
			continue
		}
		seen++
		want, ok := expected[name]
		if !ok {
			t.Errorf("%s is not in EXPECTED.json", name)
			continue
		}
		doc, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		got := issues(t, doc)
		if len(got) != 1 || got[0].Code != want.Code || got[0].Path != want.Path {
			t.Errorf("%s: issues %+v, want exactly {%s %s}", name, got, want.Code, want.Path)
		}
	}
	if seen != len(expected) {
		t.Errorf("%d invalid fixtures, EXPECTED.json lists %d", seen, len(expected))
	}
}

func TestGeneratedThemes(t *testing.T) {
	for name, doc := range map[string]themetest.Doc{
		"handmade, both modes": themetest.Valid("ocean"),
		"dark only":            themetest.Valid("synth", "dark"),
		"seeded":               themetest.Seeded("brand"),
	} {
		if got := issues(t, themetest.JSON(doc)); got != nil {
			t.Errorf("%s: %+v", name, got)
		}
	}
}

// TestRoundTrip: a parsed theme encodes to a document that parses to the
// same theme, in DTCG shape.
func TestRoundTrip(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join(tokensDir, "fixtures", "valid", "*.json"))
	for _, f := range files {
		doc, _ := os.ReadFile(f)
		th, err := theme.Default().Parse(doc)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(th)
		again, err := theme.Default().Parse(b)
		if err != nil {
			t.Fatalf("%s: re-parse: %v", filepath.Base(f), err)
		}
		b2, _ := json.Marshal(again)
		if !bytes.Equal(b, b2) {
			t.Fatalf("%s: round trip changed the theme", filepath.Base(f))
		}
		if !strings.Contains(string(b), `"$type":"color"`) || !strings.Contains(string(b), `"colorSpace":"srgb"`) {
			t.Fatalf("not DTCG shaped: %.200s", b)
		}
	}
}

// TestPublicHoldsColoursOnly: decision 0004.
func TestPublicHoldsColoursOnly(t *testing.T) {
	th, err := theme.Default().Parse(themetest.JSON(themetest.Seeded("brand")))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(th.Public())
	var top map[string]json.RawMessage
	json.Unmarshal(b, &top)
	keys := []string{}
	for k := range top {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "modes,tokens,version" {
		t.Fatalf("public keys %v", keys)
	}
}

func light(d themetest.Doc) map[string]any {
	return d["tokens"].(map[string]any)["light"].(map[string]any)
}

func colourValue(d themetest.Doc, token string) map[string]any {
	return light(d)[token].(map[string]any)["$value"].(map[string]any)
}

// TestRulesBeyondTheFixtures covers rules the golden fixtures don't, with
// the codes and paths validate.ts gives.
func TestRulesBeyondTheFixtures(t *testing.T) {
	cases := []struct {
		name   string
		change func(d themetest.Doc)
		code   string
		path   string
	}{
		{"missing field", func(d themetest.Doc) { delete(d, "tokens") }, theme.CodeMissingField, "/tokens"},
		{"id too long", func(d themetest.Doc) { d["id"] = strings.Repeat("a", 65) }, theme.CodeBadID, "/id"},
		{"id a number", func(d themetest.Doc) { d["id"] = 5 }, theme.CodeBadID, "/id"},
		{"name blank", func(d themetest.Doc) { d["name"] = " \u00a0\ufeff" }, theme.CodeBadName, "/name"},
		{"name control", func(d themetest.Doc) { d["name"] = "a\tb" }, theme.CodeBadName, "/name"},
		{"name 101 code points", func(d themetest.Doc) { d["name"] = strings.Repeat("é", 101) }, theme.CodeBadName, "/name"},
		{"version fraction", func(d themetest.Doc) { d["version"] = 1.5 }, theme.CodeBadVersion, "/version"},
		{"version above 2^53-1", func(d themetest.Doc) { d["version"] = 9007199254740992.0 }, theme.CodeBadVersion, "/version"},
		{"version string", func(d themetest.Doc) { d["version"] = "1" }, theme.CodeBadVersion, "/version"},
		{"source not object", func(d themetest.Doc) { d["source"] = "handmade" }, theme.CodeNotObject, "/source"},
		{"source without kind", func(d themetest.Doc) { d["source"] = map[string]any{} }, theme.CodeMissingField, "/source/kind"},
		{"contrast 3", func(d themetest.Doc) {
			d["source"] = map[string]any{"kind": "seeded", "seeds": map[string]any{"primary": "#000000"}, "schemeStyle": "tonal", "contrast": 3}
		}, theme.CodeBadContrast, "/source/contrast"},
		{"seed not hex", func(d themetest.Doc) {
			d["source"] = map[string]any{"kind": "seeded", "seeds": map[string]any{"primary": "blue"}, "schemeStyle": "tonal", "contrast": 0}
		}, theme.CodeBadHex, "/source/seeds/primary"},
		{"modes not array", func(d themetest.Doc) {
			d["modes"] = "light"
		}, theme.CodeBadType, "/modes"},
		{"mode unknown", func(d themetest.Doc) {
			d["modes"] = []any{"light", "dark", "sepia"}
		}, theme.CodeBadMode, "/modes/2"},
		{"token not object", func(d themetest.Doc) { light(d)["primary"] = "#000000" }, theme.CodeNotObject, "/tokens/light/primary"},
		{"colour space", func(d themetest.Doc) { colourValue(d, "primary")["colorSpace"] = "p3" }, theme.CodeBadColorSpace, "/tokens/light/primary/$value/colorSpace"},
		{"component as string", func(d themetest.Doc) { colourValue(d, "primary")["components"] = []any{"0.5", 0, 0} }, theme.CodeBadComponents, "/tokens/light/primary/$value/components"},
		{"alpha above 1", func(d themetest.Doc) { colourValue(d, "primary")["alpha"] = 2 }, theme.CodeBadAlpha, "/tokens/light/primary/$value/alpha"},
		{"radius negative", func(d themetest.Doc) {
			light(d)["radius"] = map[string]any{"$type": "dimension", "$value": map[string]any{"value": -1, "unit": "px"}}
		}, theme.CodeBadDimension, "/tokens/light/radius/$value/value"},
		{"pointer escapes", func(d themetest.Doc) { light(d)["a/b~c"] = map[string]any{} }, theme.CodeUnknownToken, "/tokens/light/a~1b~0c"},
	}
	for _, c := range cases {
		d := themetest.Valid("ocean")
		c.change(d)
		got := issues(t, themetest.JSON(d))
		if len(got) != 1 || got[0].Code != c.code || got[0].Path != c.path {
			t.Errorf("%s: issues %+v, want exactly {%s %s}", c.name, got, c.code, c.path)
		}
	}
}

// TestAlphaAndIntegerFloats: alpha in range passes; 1.0 is an integer, as
// in JavaScript.
func TestAlphaAndIntegerFloats(t *testing.T) {
	d := themetest.Valid("ocean")
	colourValue(d, "primary")["alpha"] = 0.5
	b := bytes.Replace(themetest.JSON(d), []byte(`"version":1`), []byte(`"version":1.0`), 1)
	th, err := theme.Default().Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	if th.Version != 1 || *th.Tokens["light"]["primary"].Color.Alpha != 0.5 {
		t.Fatalf("parsed %+v", th)
	}
}

func TestUnacceptableJSON(t *testing.T) {
	good := string(themetest.JSON(themetest.Valid("ocean")))
	for name, doc := range map[string]string{
		"repeated key": `{"id":"a","id":"b"}`,
		"trailing":     good + `{}`,
		"bad utf-8":    strings.Replace(good, "Theme ocean", "Theme \xff", 1),
		"empty":        ``,
		"malformed":    `{"id":`,
	} {
		_, err := theme.Default().Parse([]byte(doc))
		if !errors.Is(err, theme.ErrJSON) {
			t.Errorf("%s: got %v", name, err)
		}
	}
	if got := issues(t, []byte(`[]`)); len(got) != 1 || got[0].Code != theme.CodeNotObject || got[0].Path != "" {
		t.Errorf("array: %+v", got)
	}
}

func TestParseManifestRefuses(t *testing.T) {
	src, err := os.ReadFile("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(m map[string]any){
		"no tokens":       func(m map[string]any) { m["tokens"] = []any{} },
		"bad kind":        func(m map[string]any) { m["tokens"].([]any)[0].(map[string]any)["kind"] = "font" },
		"duplicate token": func(m map[string]any) { m["tokens"] = append(m["tokens"].([]any), m["tokens"].([]any)[0]) },
		"bad id pattern":  func(m map[string]any) { m["limits"].(map[string]any)["idPattern"] = "(?<=a)" },
		"missing code":    func(m map[string]any) { m["errorCodes"] = []any{"not_object"} },
		"version 2":       func(m map[string]any) { m["manifestVersion"] = 2 },
	} {
		var m map[string]any
		json.Unmarshal(src, &m)
		change(m)
		b, _ := json.Marshal(m)
		if _, err := theme.ParseManifest(b); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestValidSlug(t *testing.T) {
	for s, want := range map[string]bool{"a": true, "board": true, "vibe-kanban": true, "a1-b2": true,
		"": false, "-a": false, "a-": false, "a--b": false, "A": false, "a_b": false, "none": false, "inherit": false,
		strings.Repeat("a", 65): false, strings.Repeat("a", 64): true} {
		if theme.ValidSlug(s) != want {
			t.Errorf("ValidSlug(%q) = %v", s, !want)
		}
	}
}
