package auth

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// The same settings src/utils/server/argon2.ts hashes with
const (
	hashMemory      = 65_536 // KiB, 64 MiB
	hashParallelism = 4
	hashPasses      = 3
	hashLength      = 32
	saltLength      = 16
)

// The salt and hash are written in base64url without padding, not the standard base64 of the PHC string format, as the
// Node server has always written them
var encoding = base64.RawURLEncoding

// Each hash takes 64 MiB while it runs. At most two run at once, so a burst of logins can't take the server's memory
var hashing = make(chan struct{}, 2)

// ChildArgument starts the server's own executable as a process that hashes one password and exits (see RunChild)
const ChildArgument = "argon2id-child"

// The executable to hash in, set by UseChildProcess. Unset, as in tests, hashes are made in this process
var childExecutable string

// UseChildProcess makes each hash in a short-lived process of the given executable, started with ChildArgument. The
// 64 MiB a hash takes is then the child's, given back to the system the moment it exits. Made in the server itself,
// the garbage collector frees it, but the system can go on counting it against the server long after
func UseChildProcess(executable string) {
	childExecutable = executable
}

// The work a child is given on its standard input, so the password is never in its command line
type childWork struct {
	Length      uint32 `json:"length"`
	Memory      uint32 `json:"memory"`
	Parallelism uint8  `json:"parallelism"`
	Passes      uint32 `json:"passes"`
	Password    []byte `json:"password"`
	Salt        []byte `json:"salt"`
}

func (w childWork) key() []byte {
	return argon2.IDKey(w.Password, w.Salt, w.Passes, w.Memory, w.Parallelism, w.Length)
}

// RunChild is the child process: it reads its work from in and writes the key to out
func RunChild(in io.Reader, out io.Writer) error {
	var work childWork
	if err := json.NewDecoder(in).Decode(&work); err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(work.key())
}

// idKey is argon2id, made in a child process when there is one to use
func idKey(work childWork) ([]byte, error) {
	hashing <- struct{}{}
	defer func() { <-hashing }()
	if childExecutable == "" {
		return work.key(), nil
	}
	input, err := json.Marshal(work)
	if err != nil {
		return nil, err
	}
	command := exec.Command(childExecutable, ChildArgument)
	command.Stdin = bytes.NewReader(input)
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("hashing in a child process: %w", err)
	}
	var key []byte
	if err := json.Unmarshal(output, &key); err != nil {
		return nil, err
	}
	return key, nil
}

// HashPassword hashes a password as $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash, err := idKey(childWork{
		Length: hashLength, Memory: hashMemory, Parallelism: hashParallelism, Passes: hashPasses,
		Password: []byte(password), Salt: salt,
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		"$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		hashMemory, hashPasses, hashParallelism, encoding.EncodeToString(salt), encoding.EncodeToString(hash),
	), nil
}

var errInvalidHash = errors.New("invalid argon2id hash format")

func parseParameter(value, name string) (int, error) {
	key, number, found := strings.Cut(value, "=")
	if !found || key != name {
		return 0, errInvalidHash
	}
	return strconv.Atoi(number)
}

// VerifyPassword tells whether password matches a hash HashPassword or the Node server wrote, with the settings the
// hash itself names
func VerifyPassword(encoded, password string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false, errInvalidHash
	}
	parameters := strings.Split(parts[3], ",")
	if len(parameters) != 3 {
		return false, errInvalidHash
	}
	memory, err := parseParameter(parameters[0], "m")
	if err != nil {
		return false, err
	}
	passes, err := parseParameter(parameters[1], "t")
	if err != nil {
		return false, err
	}
	parallelism, err := parseParameter(parameters[2], "p")
	if err != nil {
		return false, err
	}
	salt, err := encoding.DecodeString(strings.TrimRight(parts[4], "="))
	if err != nil {
		return false, err
	}
	expected, err := encoding.DecodeString(strings.TrimRight(parts[5], "="))
	if err != nil {
		return false, err
	}
	actual, err := idKey(childWork{
		Length: uint32(len(expected)), Memory: uint32(memory), Parallelism: uint8(parallelism), Passes: uint32(passes),
		Password: []byte(password), Salt: salt,
	})
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
