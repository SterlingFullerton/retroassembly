package web

import (
	"errors"
	"net/http"
	"testing"

	"retroassembly/server/internal/failure"
)

func TestSignInLimit(t *testing.T) {
	limit := newSignInLimit(10)
	for range limit.maxFailuresPerAccount {
		end, err := limit.begin("192.0.2.1", "admin")
		if err != nil {
			t.Fatal(err)
		}
		end(wrongPasswordGiven)
	}
	if _, err := limit.begin("192.0.2.1", " Admin "); !isStatus(err, http.StatusTooManyRequests) {
		t.Fatalf("after %d failures: %v", limit.maxFailuresPerAccount, err)
	}
	// Another username from the address, and the account from another address, go on
	for _, attempt := range [][2]string{{"192.0.2.1", "friend"}, {"192.0.2.2", "admin"}} {
		end, err := limit.begin(attempt[0], attempt[1])
		if err != nil {
			t.Fatalf("%v: %v", attempt, err)
		}
		end(signedIn)
	}

	// Sign-ins under way from one address are limited, and a finished one makes room
	var ends []func(signInOutcome)
	for range maxHashingPerAddress {
		end, err := limit.begin("192.0.2.3", "someone")
		if err != nil {
			t.Fatal(err)
		}
		ends = append(ends, end)
	}
	if _, err := limit.begin("192.0.2.3", "someone"); !isStatus(err, http.StatusTooManyRequests) {
		t.Fatalf("one too many under way: %v", err)
	}
	ends[0](signedIn)
	if _, err := limit.begin("192.0.2.3", "someone"); err != nil {
		t.Fatal(err)
	}
}

func isStatus(err error, status int) bool {
	var refused *failure.Error
	return errors.As(err, &refused) && refused.Status == status
}

// SIGN_IN_ATTEMPTS=0 counts no failures, and only sign-ins under way are limited
func TestSignInLimitOff(t *testing.T) {
	limit := newSignInLimit(0)
	for range 100 {
		end, err := limit.begin("192.0.2.1", "admin")
		if err != nil {
			t.Fatal(err)
		}
		end(wrongPasswordGiven)
	}
	if len(limit.failed) != 0 {
		t.Fatalf("failures counted: %v", limit.failed)
	}
}

func TestRefusedSignUpKeepsTheCount(t *testing.T) {
	limit := newSignInLimit(2)
	for range 2 {
		end, err := limit.begin("address", "name")
		if err != nil {
			t.Fatal(err)
		}
		end(wrongPasswordGiven)
	}
	// Nothing was learned about the password, so the two wrong ones still count
	if _, err := limit.begin("address", "name"); err == nil {
		t.Fatal("a third try was allowed")
	}
	limit = newSignInLimit(2)
	end, _ := limit.begin("address", "name")
	end(wrongPasswordGiven)
	end, _ = limit.begin("address", "name")
	end(notChecked)
	end, _ = limit.begin("address", "name")
	end(wrongPasswordGiven)
	if _, err := limit.begin("address", "name"); err == nil {
		t.Fatal("a sign-up refused in between cleared the count")
	}
}
