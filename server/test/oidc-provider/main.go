// Command oidc-provider runs the test OIDC provider on its own, over https with a certificate of its own, for checking
// the Node and Go servers' login with OIDC against the same provider:
//
//	go run ./test/oidc-provider -port 8300 -certificate /tmp/oidc-provider.pem
//
// Start the servers with NODE_EXTRA_CA_CERTS set to the certificate's file, and the issuer, client and secret it
// prints. POST /identity changes who it signs in
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"time"

	"retroassembly/server/internal/oidctest"
)

// certificate makes a certificate for localhost, and writes it to path for the servers to trust
func certificate(path string) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	template := x509.Certificate{
		DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
		NotAfter: time.Now().Add(24 * time.Hour), NotBefore: time.Now().Add(-time.Hour), SerialNumber: big.NewInt(1),
		Subject: pkix.Name{CommonName: "localhost"}, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return tls.Certificate{}, err
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, nil
}

func main() {
	port := flag.Int("port", 8300, "the port to listen on")
	certificatePath := flag.String("certificate", "oidc-provider.pem", "where to write the provider's certificate")
	flag.Parse()
	provider, err := oidctest.New()
	if err != nil {
		log.Fatal(err)
	}
	provider.Issuer = fmt.Sprintf("https://localhost:%d", *port)
	cert, err := certificate(*certificatePath)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr: fmt.Sprintf(":%d", *port), Handler: provider.Handler(),
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}
	log.Printf("OIDC provider at %s, client %q, secret %q, certificate in %s", provider.Issuer, oidctest.ClientID,
		oidctest.ClientSecret, *certificatePath)
	log.Fatal(server.ListenAndServeTLS("", ""))
}
