// Package trust is how the server checks the certificates of the servers it calls: the CDN, libretro's thumbnails and
// an OIDC provider.
package trust

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"log"
	"net/http"
	"os"
	"sync"
)

var (
	warned sync.Once
)

// Transport is an HTTP transport that trusts the system's certificate authorities and, as Node did for every request,
// those in the file NODE_EXTRA_CA_CERTS names (extraCertificates): for a provider with a certificate of its own, or a
// network that inspects TLS. A file that can't be read is warned about once and left out, as Node leaves it out
func Transport(extraCertificates string) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if extraCertificates == "" {
		return transport
	}
	extra := x509.NewCertPool()
	certificates, err := os.ReadFile(extraCertificates)
	if err != nil || !extra.AppendCertsFromPEM(certificates) {
		warned.Do(func() { log.Printf("Ignoring extra certificates in %s: none could be read", extraCertificates) })
		return transport
	}
	transport.TLSClientConfig = &tls.Config{
		// Checked below instead, against the system's authorities and then the extra ones: on macOS the system's can't be
		// added to
		InsecureSkipVerify: true,
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("the server sent no certificate")
			}
			intermediates := x509.NewCertPool()
			for _, certificate := range state.PeerCertificates[1:] {
				intermediates.AddCert(certificate)
			}
			options := x509.VerifyOptions{DNSName: state.ServerName, Intermediates: intermediates}
			_, err := state.PeerCertificates[0].Verify(options)
			if err == nil {
				return nil
			}
			options.Roots = extra
			if _, extraErr := state.PeerCertificates[0].Verify(options); extraErr == nil {
				return nil
			}
			return err
		},
	}
	return transport
}
