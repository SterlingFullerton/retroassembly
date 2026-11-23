package web

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/failure"
)

const (
	// How long failed sign-ins are counted for
	failureWindow = 15 * time.Minute
	// Failed sign-ins allowed from one address for all usernames, as a multiple of those for one username
	// (SIGN_IN_ATTEMPTS). Behind a reverse proxy every visitor has the proxy's address, so it's high
	addressFailuresPerAccount = 5
	// Sign-ins under way at once from one address, waiting their turn or checking a password. Only 2 checks run at once
	// in all, and 32 wait, so one address can't fill the queue and keep everyone else from signing in
	maxHashingPerAddress = 8
)

type failures struct {
	count int
	since time.Time
}

// signInLimit counts failed sign-ins and the password checks under way, by address and username
type signInLimit struct {
	mutex  sync.Mutex
	failed map[string]*failures
	// Failed sign-ins allowed in the window for one username from one address, guessing a password slowed to a crawl
	// without anyone locking an account out from another address, and for all usernames from it. 0 for no limit
	maxFailuresPerAccount, maxFailuresPerAddress int
	hashing                                      map[string]int
	lastTidy                                     time.Time
}

// newSignInLimit allows attempts wrong passwords per username and address in the window, or any number for 0
func newSignInLimit(attempts int) *signInLimit {
	return &signInLimit{
		failed: map[string]*failures{}, hashing: map[string]int{},
		maxFailuresPerAccount: attempts, maxFailuresPerAddress: attempts * addressFailuresPerAccount,
	}
}

func accountKey(address, username string) string {
	return address + "\x00" + strings.ToLower(strings.TrimSpace(username))
}

// tidy forgets failures older than the window, now and then, so the counts don't grow without end
func (l *signInLimit) tidy(now time.Time) {
	if now.Sub(l.lastTidy) < time.Minute {
		return
	}
	l.lastTidy = now
	for key, counted := range l.failed {
		if now.Sub(counted.since) >= failureWindow {
			delete(l.failed, key)
		}
	}
}

func (l *signInLimit) waitFor(key string, limit int, now time.Time) time.Duration {
	counted := l.failed[key]
	if limit == 0 || counted == nil || now.Sub(counted.since) >= failureWindow || counted.count < limit {
		return 0
	}
	return failureWindow - now.Sub(counted.since)
}

// How a password check ended: the password was right, it was wrong, or there was none to judge, as when a sign-up is
// refused for its username
type signInOutcome int

const (
	signedIn signInOutcome = iota
	wrongPasswordGiven
	notChecked
)

// outcomeOf is how a sign-in that ended with err went: only a password that didn't match counts against it
func outcomeOf(err error) signInOutcome {
	if wrongPassword(err) {
		return wrongPasswordGiven
	}
	return signedIn
}

// begin starts a password check for an address and username, or is the error to answer with: too many failures, or
// too many checks under way. A started check is ended with the function it returns, saying how it went
func (l *signInLimit) begin(address, username string) (func(signInOutcome), error) {
	now := time.Now()
	l.mutex.Lock()
	defer l.mutex.Unlock()
	l.tidy(now)
	wait := max(l.waitFor(accountKey(address, username), l.maxFailuresPerAccount, now),
		l.waitFor(address, l.maxFailuresPerAddress, now))
	if wait > 0 {
		minutes := int(math.Ceil(wait.Minutes()))
		return nil, failure.New(http.StatusTooManyRequests,
			fmt.Sprintf("Too many failed sign-ins. Try again in %d minute(s)", minutes))
	}
	if l.hashing[address] >= maxHashingPerAddress {
		return nil, failure.New(http.StatusTooManyRequests, "Too many sign-ins at once. Try again in a moment")
	}
	l.hashing[address]++
	return func(outcome signInOutcome) {
		l.mutex.Lock()
		defer l.mutex.Unlock()
		if l.hashing[address]--; l.hashing[address] <= 0 {
			delete(l.hashing, address)
		}
		// Nothing learned about the password: the count of wrong ones stays as it was
		if outcome == notChecked {
			return
		}
		key := accountKey(address, username)
		if outcome == signedIn || l.maxFailuresPerAccount == 0 {
			delete(l.failed, key)
			return
		}
		now := time.Now()
		for _, each := range []string{key, address} {
			counted := l.failed[each]
			if counted == nil || now.Sub(counted.since) >= failureWindow {
				counted = &failures{since: now}
				l.failed[each] = counted
			}
			counted.count++
		}
	}, nil
}

// wrongPassword tells whether an error is a password that didn't match, the only failure counted against a sign-in
func wrongPassword(err error) bool {
	var refused *failure.Error
	return errors.As(err, &refused) && refused.Status == http.StatusUnauthorized
}
