package theme

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
)

// Kind is what a token holds: its DTCG $type.
type Kind string

const (
	KindColor     Kind = "color"
	KindDimension Kind = "dimension"
)

// Spec is one token the manifest lists.
type Spec struct {
	Name     string `json:"name"`
	Group    string `json:"group"`
	Kind     Kind   `json:"kind"`
	Required bool   `json:"required"`
	On       string `json:"on,omitempty"` // for a foreground: the token it is drawn on
}

// Limits are the manifest's bounds on a theme's fields.
type Limits struct {
	IDMaxLength   int     `json:"idMaxLength"`
	IDPattern     string  `json:"idPattern"`
	NameMaxLength int     `json:"nameMaxLength"`
	HexPattern    string  `json:"hexPattern"`
	HexTolerance  float64 `json:"hexTolerance"`
}

// Manifest is the token contract from packages/tokens/tokens.manifest.json
// (T-116), copied to manifest.json here so it can be embedded. A test fails
// when the copy differs from the source: after the tokens package
// regenerates its manifest, copy it again.
type Manifest struct {
	ManifestVersion int       `json:"manifestVersion"`
	Tokens          []Spec    `json:"tokens"`
	Modes           []string  `json:"modes"`
	SourceKinds     []string  `json:"sourceKinds"`
	SchemeStyles    []string  `json:"schemeStyles"`
	ContrastLevels  []float64 `json:"contrastLevels"`
	DimensionUnits  []string  `json:"dimensionUnits"`
	Limits          Limits    `json:"limits"`
	ErrorCodes      []string  `json:"errorCodes"`

	specs map[string]Spec
	idRE  *regexp.Regexp
	hexRE *regexp.Regexp
	codes map[string]bool
}

//go:embed manifest.json
var manifestJSON []byte

var defaultManifest = mustParse(manifestJSON)

func mustParse(b []byte) *Manifest {
	m, err := ParseManifest(b)
	if err != nil {
		panic("theme: embedded manifest: " + err.Error())
	}
	return m
}

// Default is the embedded manifest.
func Default() *Manifest { return defaultManifest }

// ParseManifest reads and checks a manifest.
func ParseManifest(data []byte) (*Manifest, error) {
	m := &Manifest{}
	if err := json.Unmarshal(data, m); err != nil {
		return nil, fmt.Errorf("manifest: %w", err)
	}
	if m.ManifestVersion != 1 {
		return nil, fmt.Errorf("manifest: version %d, want 1", m.ManifestVersion)
	}
	if len(m.Tokens) == 0 || len(m.Modes) == 0 || len(m.SourceKinds) == 0 || len(m.SchemeStyles) == 0 ||
		len(m.ContrastLevels) == 0 || len(m.DimensionUnits) == 0 || len(m.ErrorCodes) == 0 {
		return nil, fmt.Errorf("manifest: a list is empty")
	}
	if m.Limits.IDMaxLength < 1 || m.Limits.NameMaxLength < 1 || m.Limits.HexTolerance < 0 || m.Limits.HexTolerance >= 1 {
		return nil, fmt.Errorf("manifest: bad limits")
	}
	var err error
	if m.idRE, err = regexp.Compile(m.Limits.IDPattern); err != nil {
		return nil, fmt.Errorf("manifest: idPattern: %w", err)
	}
	if m.hexRE, err = regexp.Compile(m.Limits.HexPattern); err != nil {
		return nil, fmt.Errorf("manifest: hexPattern: %w", err)
	}
	m.specs = map[string]Spec{}
	for _, s := range m.Tokens {
		if s.Name == "" {
			return nil, fmt.Errorf("manifest: a token has no name")
		}
		if _, dup := m.specs[s.Name]; dup {
			return nil, fmt.Errorf("manifest: token %q listed twice", s.Name)
		}
		if s.Kind != KindColor && s.Kind != KindDimension {
			return nil, fmt.Errorf("manifest: token %q has kind %q", s.Name, s.Kind)
		}
		m.specs[s.Name] = s
	}
	m.codes = map[string]bool{}
	for _, c := range m.ErrorCodes {
		m.codes[c] = true
	}
	for _, c := range allCodes {
		if !m.codes[c] {
			return nil, fmt.Errorf("manifest: error code %q is missing", c)
		}
	}
	return m, nil
}

// Specs lists the tokens in manifest order.
func (m *Manifest) Specs() []Spec { return append([]Spec{}, m.Tokens...) }

func contains[T comparable](list []T, v T) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
