package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"

	"golang.org/x/crypto/argon2"

	"retroassembly/server/internal/failure"
)

// The same settings src/utils/server/argon2.ts hashes with
const (
	hashMemory      = 65_536 // KiB, 64 MiB
	hashParallelism = 4
	hashPasses      = 3
	hashLength      = 32
	saltLength      = 16
)

// The salt and hash are written in base64url without padding, as the Node server wrote them since December 2025.
// Hashes from before then (the npm argon2 package's) are in standard base64, which decodeBase64 reads too
var encoding = base64.RawURLEncoding

func decodeBase64(value string) ([]byte, error) {
	return encoding.DecodeString(strings.NewReplacer("+", "-", "/", "_").Replace(strings.TrimRight(value, "=")))
}

// Each hash takes 64 MiB while it runs. At most two run at once, so a burst of logins can't take the server's memory,
// and only so many wait for their turn: past that, a sign-in is refused rather than queued for minutes
var (
	hashing    = make(chan struct{}, 2)
	waiting    atomic.Int32
	maxWaiting = int32(32)
)

var errBusy = failure.New(http.StatusServiceUnavailable, "Too many sign-ins at once. Try again in a moment")

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

// idKey is argon2id, made in a child process when there is one to use. A request that ends while it waits, or while
// its hash is made, stops it
func idKey(ctx context.Context, work childWork) ([]byte, error) {
	if waiting.Add(1) > maxWaiting {
		waiting.Add(-1)
		return nil, errBusy
	}
	select {
	case hashing <- struct{}{}:
		waiting.Add(-1)
	case <-ctx.Done():
		waiting.Add(-1)
		return nil, ctx.Err()
	}
	defer func() { <-hashing }()
	if childExecutable == "" {
		return work.key(), nil
	}
	input, err := json.Marshal(work)
	if err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, childExecutable, ChildArgument)
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
func HashPassword(ctx context.Context, password string) (string, error) {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash, err := idKey(ctx, childWork{
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
func VerifyPassword(ctx context.Context, encoded, password string) (bool, error) {
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
	salt, err := decodeBase64(parts[4])
	if err != nil {
		return false, err
	}
	expected, err := decodeBase64(parts[5])
	if err != nil {
		return false, err
	}
	actual, err := idKey(ctx, childWork{
		Length: uint32(len(expected)), Memory: uint32(memory), Parallelism: uint8(parallelism), Passes: uint32(passes),
		Password: []byte(password), Salt: salt,
	})
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}
