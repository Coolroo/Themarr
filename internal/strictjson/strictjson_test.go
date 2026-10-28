package strictjson

import (
	"strings"
	"testing"
)

type app struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Origins []string `json:"origins"`
}

var appFields = map[string][]string{"": {"id", "name", "origins"}}

func TestDecodeAcceptsExactFields(t *testing.T) {
	var a app
	if err := Decode([]byte(`{"id":"board","name":"Board","origins":["https://board.test"]}`), &a, appFields); err != nil {
		t.Fatal(err)
	}
	if a.ID != "board" || a.Name != "Board" || len(a.Origins) != 1 {
		t.Fatalf("decoded %+v", a)
	}
}

func TestDecodeRefuses(t *testing.T) {
	for name, body := range map[string]string{
		"unknown field":     `{"id":"a","extra":1}`,
		"other case":        `{"ID":"a"}`,
		"repeated key":      `{"id":"a","id":"b"}`,
		"repeated deep":     `{"x":{"a":1,"a":2}}`,
		"array":             `["a"]`,
		"two objects":       `{"id":"a"}{"id":"b"}`,
		"trailing garbage":  `{"id":"a"} x`,
		"malformed":         `{"id":`,
		"empty":             ``,
		"wrong type":        `{"id":5}`,
		"too deep":          `{"origins":[[[[[[[[["a"]]]]]]]]]}`,
		"invalid utf-8":     "{\"id\":\"\xff\"}",
		"string not object": `"a"`,
	} {
		var a app
		if err := Decode([]byte(body), &a, appFields); err == nil {
			t.Errorf("%s: accepted %q", name, body)
		}
	}
}

func TestErrorsQuoteBoundedKeys(t *testing.T) {
	long := strings.Repeat("k", 500)
	err := CheckKeys([]byte(`{"`+long+`":1}`), appFields)
	if err == nil || len(err.Error()) > 120 {
		t.Fatalf("error %v", err)
	}
}

func TestUncheckedPathsTakeAnyKeys(t *testing.T) {
	if err := CheckKeys([]byte(`{"perApp":{"a":"x","b":"y"}}`), map[string][]string{"": {"perApp"}}); err != nil {
		t.Fatal(err)
	}
}
