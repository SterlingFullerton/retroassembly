package auth

import (
	"os"
	"strings"
	"testing"
)

// Written by the Node server's src/utils/server/argon2.ts for "correct horse battery staple"
const nodeHash = "$argon2id$v=19$m=65536,t=3,p=4$-dqUanTX_JBWcbg8v38atw$0EbRQDBEufifewk-YwmyJ3n1axAx4DpQcrz9tZ5_M8w"

func TestVerifyNodeHash(t *testing.T) {
	ok, err := VerifyPassword(nodeHash, "correct horse battery staple")
	if err != nil || !ok {
		t.Fatalf("the Node hash should verify: %v, %v", ok, err)
	}
	ok, err = VerifyPassword(nodeHash, "wrong")
	if err != nil || ok {
		t.Fatalf("a wrong password should not verify: %v, %v", ok, err)
	}
}

func TestHashRoundTrip(t *testing.T) {
	hash, err := HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	prefix := "$argon2id$v=19$m=65536,t=3,p=4$"
	if !strings.HasPrefix(hash, prefix) || strings.ContainsAny(strings.TrimPrefix(hash, prefix), "+/=") {
		t.Fatalf("hash is not in the Node server's format: %s", hash)
	}
	if ok, err := VerifyPassword(hash, "secret"); err != nil || !ok {
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
	if ok, err := VerifyPassword(nodeHash, "correct horse battery staple"); err != nil || !ok {
		t.Fatalf("the Node hash should verify in a child process: %v, %v", ok, err)
	}
	hash, err := HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	UseChildProcess("")
	if ok, err := VerifyPassword(hash, "secret"); err != nil || !ok {
		t.Fatalf("a hash made in a child process should verify in this one: %v, %v", ok, err)
	}
}

func TestInvalidHash(t *testing.T) {
	for _, hash := range []string{"", "$argon2i$v=19$m=1,t=1,p=1$a$b", "$argon2id$v=19$m=1,t=1$a$b", "plain"} {
		if _, err := VerifyPassword(hash, "x"); err == nil {
			t.Errorf("%q should be refused", hash)
		}
	}
}
