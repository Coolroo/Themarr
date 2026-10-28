package identity

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func request(headers ...string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Add(headers[i], headers[i+1])
	}
	return r
}

func TestAutheliaAccepts(t *testing.T) {
	for _, c := range []struct {
		headers []string
		want    Identity
	}{
		{[]string{"Remote-User", "alice"}, Identity{User: "alice"}},
		{[]string{"Remote-User", "a.b_c@d-e", "Remote-Groups", "users, admins ,,"}, Identity{User: "a.b_c@d-e", Groups: []string{"users", "admins"}}},
		{[]string{"Remote-User", "bob", "Remote-Groups", ""}, Identity{User: "bob"}},
		{[]string{"Remote-User", strings.Repeat("x", 128)}, Identity{User: strings.Repeat("x", 128)}},
	} {
		got, ok := Authelia{}.Identify(request(c.headers...))
		if !ok || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%v: %+v %v", c.headers, got, ok)
		}
	}
}

func TestAutheliaRefuses(t *testing.T) {
	for name, h := range map[string][]string{
		"none":            nil,
		"groups only":     {"Remote-Groups", "admins"},
		"empty user":      {"Remote-User", ""},
		"space":           {"Remote-User", "bad user"},
		"comma":           {"Remote-User", "a,b"},
		"too long":        {"Remote-User", strings.Repeat("x", 129)},
		"non-ascii":       {"Remote-User", "álice"},
		"repeated user":   {"Remote-User", "a", "Remote-User", "b"},
		"repeated groups": {"Remote-User", "a", "Remote-Groups", "users", "Remote-Groups", "admins"},
	} {
		if id, ok := (Authelia{}).Identify(request(h...)); ok {
			t.Errorf("%s: accepted as %+v", name, id)
		}
	}
}

func TestSourceInterface(t *testing.T) {
	var s Source = Authelia{}
	if _, ok := s.Identify(request("Remote-User", "x")); !ok {
		t.Fatal("Authelia as a Source")
	}
	s = Func(func(*http.Request) (Identity, bool) { return Identity{User: "f"}, true })
	if id, ok := s.Identify(request()); !ok || id.User != "f" {
		t.Fatal("Func as a Source")
	}
}

func TestInGroupIsExact(t *testing.T) {
	id := Identity{User: "a", Groups: []string{"users", "admins"}}
	if !id.InGroup("admins") || id.InGroup("Admins") || id.InGroup("admin") || id.InGroup("") {
		t.Fatal("InGroup")
	}
}

func TestValidName(t *testing.T) {
	for _, s := range []string{"a", "A.b_c@d-e", "0"} {
		if !ValidName(s) {
			t.Errorf("%q refused", s)
		}
	}
	for _, s := range []string{"", "a b", "a/b", "a,b", "a\nb", strings.Repeat("x", 129)} {
		if ValidName(s) {
			t.Errorf("%q accepted", s)
		}
	}
}
