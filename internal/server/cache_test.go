package server

import (
	"net/http"
	"testing"
)

// TestPublicAnswersAreCachedPerSnapshot (T-115 review): the catalog and
// each theme's public body are made once per store snapshot, not per
// request, and a write makes new ones.
func TestPublicAnswersAreCachedPerSnapshot(t *testing.T) {
	hs := newHarness(t)
	hs.putNamed("ocean", "Ocean")
	hs.assign("ocean", nil)
	d := hs.store.Snapshot()
	c := hs.srv.cached(d)
	b1, tag1 := c.catalog()
	if hs.srv.cached(d) != c {
		t.Fatal("a second request built another cache for the same snapshot")
	}
	b2, tag2 := hs.srv.cached(d).catalog()
	if &b1[0] != &b2[0] || tag1 != tag2 {
		t.Fatal("the catalog was built again for the same snapshot")
	}
	th := d.Themes["ocean"]
	if t1, t2 := c.themeBody(th), hs.srv.cached(d).themeBody(th); &t1[0] != &t2[0] {
		t.Fatal("a theme body was encoded again for the same snapshot")
	}
	// What the routes send is what the cache holds.
	if rr := hs.do(http.MethodGet, "/v1/catalog", ""); rr.Body.String() != string(b1) || rr.Header().Get("ETag") != tag1 {
		t.Fatalf("catalog %s", rr.Body.String())
	}
	if rr := hs.do(http.MethodGet, "/v1/apps/board/theme", ""); rr.Body.String() != string(c.themeBody(th)) {
		t.Fatalf("theme %s", rr.Body.String())
	}

	// A write: a new snapshot, a new catalog.
	hs.putNamed("forest", "Forest")
	rr := hs.do(http.MethodGet, "/v1/catalog", "")
	if rr.Header().Get("ETag") == tag1 || rr.Body.String() == string(b1) {
		t.Fatal("the catalog did not change after a write")
	}
	newest := hs.srv.cache.Load()
	if newest.data != hs.store.Snapshot() {
		t.Fatal("the cache is not the newest snapshot's")
	}
	// A request still holding the old snapshot doesn't replace it.
	if old := hs.srv.cached(d); old == newest || hs.srv.cache.Load() != newest {
		t.Fatal("an older snapshot replaced the newest cache")
	}
}
