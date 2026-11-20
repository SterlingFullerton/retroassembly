package web

import (
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// A provider with a certificate of its own is trusted through NODE_EXTRA_CA_CERTS, and only through it
func TestOIDCExtraCertificates(t *testing.T) {
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer provider.Close()
	file := filepath.Join(t.TempDir(), "extra.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: provider.Certificate().Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		file  string
		works bool
	}{{file, true}, {"", false}, {filepath.Join(t.TempDir(), "missing.pem"), false}} {
		response, err := oidcClient(test.file).Get(provider.URL)
		if err == nil {
			response.Body.Close()
		}
		if (err == nil) != test.works {
			t.Errorf("%q: %v", test.file, err)
		}
	}
}
