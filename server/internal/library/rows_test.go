package library

import "testing"

// What JavaScript's JSON.stringify(JSON.parse(text)) gives each
func TestNormalizeJSON(t *testing.T) {
	cases := map[string]string{
		`{"b":2.0,"a":[1.50, 3e2, -0.0001, 1e21, 123456789012],"c":{"z":null,"y":true}}`: `{"b":2,"a":[1.5,300,-0.0001,1e+21,123456789012],"c":{"z":null,"y":true}}`,
		`[]`:                      `[]`,
		`{}`:                      `{}`,
		`"a<b>&c"`:                `"a<b>&c"`,
		`[{"a":[{}],"b":[[]]},2]`: `[{"a":[{}],"b":[[]]},2]`,
		`{ "x" : "éé" }`:          `{"x":"éé"}`,
	}
	for input, want := range cases {
		got, err := normalizeJSON(input)
		if err != nil || string(got) != want {
			t.Errorf("normalizeJSON(%s) = %s, %v; want %s", input, got, err, want)
		}
	}
}
