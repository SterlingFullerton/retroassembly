package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// Written by the Node server's src/utils/server/argon2.ts for "correct horse battery staple"
const nodeHash = "$argon2id$v=19$m=65536,t=3,p=4$-dqUanTX_JBWcbg8v38atw$0EbRQDBEufifewk-YwmyJ3n1axAx4DpQcrz9tZ5_M8w"

func TestVerifyNodeHash(t *testing.T) {
	ok, err := VerifyPassword(context.Background(), nodeHash, "correct horse battery staple")
	if err != nil || !ok {
		t.Fatalf("the Node hash should verify: %v, %v", ok, err)
	}
	ok, err = VerifyPassword(context.Background(), nodeHash, "wrong")
	if err != nil || ok {
		t.Fatalf("a wrong password should not verify: %v, %v", ok, err)
	}
}

func TestHashRoundTrip(t *testing.T) {
	hash, err := HashPassword(context.Background(), "secret")
	if err != nil {
		t.Fatal(err)
	}
	prefix := "$argon2id$v=19$m=65536,t=3,p=4$"
	if !strings.HasPrefix(hash, prefix) || strings.ContainsAny(strings.TrimPrefix(hash, prefix), "+/=") {
		t.Fatalf("hash is not in the Node server's format: %s", hash)
	}
	if ok, err := VerifyPassword(context.Background(), hash, "secret"); err != nil || !ok {
		t.Fatalf("own hash should verify: %v, %v", ok, err)
	}
}

// The test binary stands in for the server's executable: started with ChildArgument, it hashes as the server's child
// process would
func TestMain(m *testing.M) {
	if len(os.Args) == 2 && os.Args[1] == ChildArgument {
		if err := RunChild(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestChildProcess(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	UseChildProcess(executable)
	defer UseChildProcess("")
	if ok, err := VerifyPassword(context.Background(), nodeHash, "correct horse battery staple"); err != nil || !ok {
		t.Fatalf("the Node hash should verify in a child process: %v, %v", ok, err)
	}
	hash, err := HashPassword(context.Background(), "secret")
	if err != nil {
		t.Fatal(err)
	}
	UseChildProcess("")
	if ok, err := VerifyPassword(context.Background(), hash, "secret"); err != nil || !ok {
		t.Fatalf("a hash made in a child process should verify in this one: %v, %v", ok, err)
	}
}

func TestInvalidHash(t *testing.T) {
	for _, hash := range []string{"", "$argon2i$v=19$m=1,t=1,p=1$a$b", "$argon2id$v=19$m=1,t=1$a$b", "plain"} {
		if _, err := VerifyPassword(context.Background(), hash, "x"); err == nil {
			t.Errorf("%q should be refused", hash)
		}
	}
}

// Hashes from before December 2025 were made by the npm argon2 package, whose salt and hash are standard base64
func TestVerifyStandardBase64Hash(t *testing.T) {
	salt, hash := []byte("a salt with/some+bits"), []byte(nil)
	hash = childWork{Length: 32, Memory: 1024, Parallelism: 1, Passes: 1, Password: []byte("old secret"), Salt: salt}.key()
	for _, encode := range []*base64.Encoding{base64.RawStdEncoding, base64.StdEncoding} {
		encoded := "$argon2id$v=19$m=1024,t=1,p=1$" + encode.EncodeToString(salt) + "$" + encode.EncodeToString(hash)
		if !strings.ContainsAny(encoded[30:], "+/") {
			t.Fatalf("no + or / in %s", encoded)
		}
		if ok, err := VerifyPassword(context.Background(), encoded, "old secret"); err != nil || !ok {
			t.Fatalf("%s: %v %v", encoded, ok, err)
		}
		if ok, _ := VerifyPassword(context.Background(), encoded, "wrong"); ok {
			t.Fatal("a wrong password matched")
		}
	}
}

// A sign-in whose request ends while it waits for its turn stops waiting
func TestHashingStopsWithItsRequest(t *testing.T) {
	for range cap(hashing) {
		hashing <- struct{}{}
	}
	defer func() {
		for range cap(hashing) {
			<-hashing
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := HashPassword(ctx, "secret"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
	if waiting.Load() != 0 {
		t.Fatalf("%d still waiting", waiting.Load())
	}
}

// The hash a sign-in for an unknown username is checked against is a valid one that nothing matches
func TestUnknownUserHash(t *testing.T) {
	if ok, err := VerifyPassword(context.Background(), unknownUserHash, ""); err != nil || ok {
		t.Fatalf("%v %v", ok, err)
	}
}
