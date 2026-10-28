package server

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"

	"github.com/Coolroo/themarr/internal/theme/themetest"
)

// putNamed stores a theme with a given name (and modes).
func (hs *harness) putNamed(id, name string, modes ...string) themetest.Doc {
	hs.t.Helper()
	d := themetest.Valid(id, modes...)
	d["name"] = name
	hs.mustWrite(http.MethodPut, "/v1/themes/"+id, string(themetest.JSON(d)))
	return d
}

func TestCatalogShapeAndSort(t *testing.T) {
	hs := newHarness(t)
	rr := hs.do(http.MethodGet, "/v1/catalog", "")
	if rr.Code != 200 || strings.TrimSpace(rr.Body.String()) != `{"themes":[],"favourites":[]}` {
		t.Fatalf("empty: %d %s", rr.Code, rr.Body.String())
	}
	checkCORS(t, rr.Header())

	hs.putNamed("zed", "zebra")
	doc := hs.putNamed("ocean", "Ocean", "dark")
	hs.putNamed("apple", "Apple")
	hs.putNamed("b-apple", "apple") // same name, another case: then by id
	hs.mustWrite(http.MethodPut, "/v1/themes/brand", string(themetest.JSON(themetest.Seeded("brand"))))
	hs.mustWrite(http.MethodPut, "/v1/favourites", `{"favourites":["ocean","apple"]}`)

	rr = hs.do(http.MethodGet, "/v1/catalog", "")
	if rr.Code != 200 || rr.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %v", rr.Code, rr.Header())
	}
	checkCORS(t, rr.Header())
	var c struct {
		Themes []struct {
			ID      string                       `json:"id"`
			Name    string                       `json:"name"`
			Version int64                        `json:"version"`
			Modes   []string                     `json:"modes"`
			Swatch  map[string]map[string]string `json:"swatch"`
		} `json:"themes"`
		Favourites []string `json:"favourites"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, e := range c.Themes {
		ids = append(ids, e.ID)
	}
	if strings.Join(ids, ",") != "apple,b-apple,ocean,brand,zed" {
		t.Fatalf("order %v", ids)
	}
	if strings.Join(c.Favourites, ",") != "ocean,apple" {
		t.Fatalf("favourites %v", c.Favourites)
	}
	oc := c.Themes[2]
	if oc.Name != "Ocean" || oc.Version != 1 || strings.Join(oc.Modes, ",") != "dark" || len(oc.Swatch) != 1 {
		t.Fatalf("ocean %+v", oc)
	}
	want := func(tok string) string {
		v := doc["tokens"].(map[string]any)["dark"].(map[string]any)[tok].(map[string]any)["$value"].(map[string]any)["hex"].(string)
		return strings.ToUpper(v)
	}
	sw := oc.Swatch["dark"]
	if sw["primary"] != want("primary") || sw["background"] != want("background") || sw["foreground"] != want("foreground") || sw["tag"] != want("tag") {
		t.Fatalf("swatch %v", sw)
	}
	keys := []string{}
	for k := range sw {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "background,foreground,primary,tag" {
		t.Fatalf("swatch keys %v", keys)
	}
	// Nothing beyond names and colours: no source, seeds, apps or origins.
	body := rr.Body.String()
	for _, leak := range []string{"#3366ff", "#3366FF", "seeded", "source", "handmade", "origins", "perApp"} {
		if strings.Contains(body, leak) {
			t.Errorf("the catalog holds %q", leak)
		}
	}
}

func TestCatalogTagIsOptional(t *testing.T) {
	hs := newHarness(t)
	d := themetest.Valid("plain", "light")
	delete(d["tokens"].(map[string]any)["light"].(map[string]any), "tag")
	delete(d["tokens"].(map[string]any)["light"].(map[string]any), "tag-foreground")
	hs.mustWrite(http.MethodPut, "/v1/themes/plain", string(themetest.JSON(d)))
	rr := hs.do(http.MethodGet, "/v1/catalog", "")
	if strings.Contains(rr.Body.String(), `"tag"`) {
		t.Fatalf("an absent tag is in the swatch: %s", rr.Body.String())
	}
}

func TestCatalogETagAnd304(t *testing.T) {
	hs := newHarness(t)
	hs.putNamed("ocean", "Ocean")
	rr := hs.do(http.MethodGet, "/v1/catalog", "")
	tag := rr.Header().Get("ETag")
	if len(tag) < 3 || tag[0] != '"' || strings.HasPrefix(tag, "W/") {
		t.Fatalf("tag %q", tag)
	}
	for _, inm := range []string{tag, "W/" + tag, `"x", ` + tag, "*"} {
		rr := hs.do(http.MethodGet, "/v1/catalog", "", "If-None-Match", inm)
		if rr.Code != http.StatusNotModified || rr.Body.Len() != 0 || rr.Header().Get("ETag") != tag {
			t.Fatalf("If-None-Match %s: %d", inm, rr.Code)
		}
		checkCORS(t, rr.Header())
	}
	if rr := hs.do(http.MethodHead, "/v1/catalog", ""); rr.Code != 200 || rr.Body.Len() != 0 || rr.Header().Get("ETag") != tag {
		t.Fatalf("HEAD: %d %d bytes", rr.Code, rr.Body.Len())
	}
	// A change to anything the body shows changes the tag.
	hs.putNamed("ocean", "Ocean")
	rr = hs.do(http.MethodGet, "/v1/catalog", "", "If-None-Match", tag)
	if rr.Code != 200 || rr.Header().Get("ETag") == tag {
		t.Fatalf("after an update: %d", rr.Code)
	}
	// Other methods are not routes.
	problem(t, hs.do(http.MethodPost, "/v1/catalog", ""), http.StatusNotFound, "not_found")
}

// TestCatalogIgnoresRemoteHeaders: the catalog is on the Authelia bypass,
// so identity headers must change nothing (decision 0009).
func TestCatalogIgnoresRemoteHeaders(t *testing.T) {
	hs := newHarness(t)
	hs.putNamed("ocean", "Ocean")
	plain := hs.do(http.MethodGet, "/v1/catalog", "")
	spoofed := hs.do(http.MethodGet, "/v1/catalog", "", "Remote-User", "alice", "Remote-Groups", "admins")
	if plain.Code != 200 || spoofed.Code != 200 || plain.Body.String() != spoofed.Body.String() ||
		plain.Header().Get("ETag") != spoofed.Header().Get("ETag") {
		t.Fatal("Remote-* changed the catalog")
	}
	// The identity function is never called on this route.
	called := false
	hs2 := newHarness(t, func(o *Options) {
		o.Identify = func(r *http.Request) (Identity, bool) { called = true; return Identity{}, false }
	})
	hs2.do(http.MethodGet, "/v1/catalog", "", "Remote-User", "alice")
	if called {
		t.Fatal("the catalog read the caller's identity")
	}
}
