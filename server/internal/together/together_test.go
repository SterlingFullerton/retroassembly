package together

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

var game = Invitation{Controls: "nes", Offer: "the offer", Title: "Balloon Fight"}

func TestAGuestFindsAndAnswersAnInvitation(t *testing.T) {
	invitations := New()
	code, err := invitations.Open("host", game)
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != codeLength || strings.Trim(code, alphabet) != "" {
		t.Fatalf("code %q", code)
	}

	// However the guest types it
	typed := strings.ToLower(code[:3]) + " " + code[3:]
	found, err := invitations.Find(typed)
	if err != nil || found != game {
		t.Fatalf("found %+v, %v", found, err)
	}
	if _, err := invitations.Find("NOSUCH"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown code: %v", err)
	}

	if err := invitations.Answer(typed, "the answer"); err != nil {
		t.Fatal(err)
	}
	// Only one guest joins
	if err := invitations.Answer(code, "another answer"); !errors.Is(err, ErrAnswered) {
		t.Fatalf("second answer: %v", err)
	}

	// Someone else can't collect the host's answer
	if _, err := invitations.WaitForAnswer(context.Background(), code, "other", time.Second); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user's wait: %v", err)
	}
	answer, err := invitations.WaitForAnswer(context.Background(), code, "host", time.Second)
	if err != nil || answer != "the answer" {
		t.Fatalf("answer %q, %v", answer, err)
	}
	// Collected, it's gone
	if _, err := invitations.Find(code); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after collecting: %v", err)
	}
}

func TestAHostWaitsForAnAnswer(t *testing.T) {
	invitations := New()
	code, _ := invitations.Open("host", game)

	// None yet: the host is told to ask again
	answer, err := invitations.WaitForAnswer(context.Background(), code, "host", 10*time.Millisecond)
	if err != nil || answer != "" {
		t.Fatalf("no answer yet: %q, %v", answer, err)
	}

	// One that arrives while the host waits is given at once
	go func() {
		time.Sleep(20 * time.Millisecond)
		invitations.Answer(code, "the answer")
	}()
	started := time.Now()
	answer, err = invitations.WaitForAnswer(context.Background(), code, "host", 5*time.Second)
	if err != nil || answer != "the answer" || time.Since(started) > time.Second {
		t.Fatalf("answer %q, %v after %s", answer, err, time.Since(started))
	}

	// A host who stops waiting is let go
	code, _ = invitations.Open("host", game)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := invitations.WaitForAnswer(ctx, code, "host", 5*time.Second); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled wait: %v", err)
	}
}

func TestInvitationsAreWithdrawnAndForgotten(t *testing.T) {
	invitations := New()
	now := time.Now()
	invitations.now = func() time.Time { return now }

	first, _ := invitations.Open("host", game)
	// A host shares one game at a time
	second, _ := invitations.Open("host", game)
	if _, err := invitations.Find(first); !errors.Is(err, ErrNotFound) {
		t.Fatalf("earlier invitation: %v", err)
	}
	if _, err := invitations.Find(second); err != nil {
		t.Fatal(err)
	}

	// Only its host withdraws it
	invitations.Close(second, "other")
	if _, err := invitations.Find(second); err != nil {
		t.Fatal(err)
	}
	invitations.Close(second, "host")
	if _, err := invitations.Find(second); !errors.Is(err, ErrNotFound) {
		t.Fatalf("withdrawn: %v", err)
	}

	// One no guest comes for is forgotten
	third, _ := invitations.Open("host", game)
	now = now.Add(lifetime + time.Second)
	if _, err := invitations.Find(third); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after its time: %v", err)
	}
	if err := invitations.Answer(third, "late"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("late answer: %v", err)
	}
}

func TestInvitationsAreLimited(t *testing.T) {
	invitations := New()
	long := strings.Repeat("x", maxTextLength+1)
	if _, err := invitations.Open("host", Invitation{Offer: long}); !errors.Is(err, ErrTooLong) {
		t.Fatalf("long offer: %v", err)
	}
	code, _ := invitations.Open("host", game)
	if err := invitations.Answer(code, long); !errors.Is(err, ErrTooLong) {
		t.Fatalf("long answer: %v", err)
	}
	for i := 1; i < maxInvitations; i++ {
		if _, err := invitations.Open("host"+string(rune('a'+i%26))+string(rune('a'+i/26)), game); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := invitations.Open("one too many", game); !errors.Is(err, ErrTooMany) {
		t.Fatalf("too many: %v", err)
	}
}

func TestGamesShownToEveryone(t *testing.T) {
	invitations := New()
	now := time.Now()
	invitations.now = func() time.Time { return now }
	if list := invitations.List(); len(list) != 0 {
		t.Fatalf("nothing shared: %+v", list)
	}

	shown := Invitation{Controls: "nes", Host: "ann", Listed: true, Offer: "an offer", Title: "Balloon Fight"}
	first, _ := invitations.Open("ann", shown)
	now = now.Add(time.Second)
	// One that asks for its code isn't shown
	hidden, _ := invitations.Open("bob", Invitation{Host: "bob", Offer: "an offer", Title: "Contra"})
	now = now.Add(time.Second)
	later := shown
	later.Host, later.Title = "cat", "Bubble Bobble"
	second, _ := invitations.Open("cat", later)

	list := invitations.List()
	if len(list) != 2 || list[0] != (Listing{Code: first, Controls: "nes", Host: "ann", Title: "Balloon Fight"}) ||
		list[1].Code != second || list[1].Title != "Bubble Bobble" {
		t.Fatalf("list %+v", list)
	}
	// Its code still finds the hidden one
	if found, err := invitations.Find(hidden); err != nil || found.Title != "Contra" {
		t.Fatalf("hidden: %+v, %v", found, err)
	}

	// A game someone has joined is no longer offered
	invitations.Answer(first, "an answer")
	if list := invitations.List(); len(list) != 1 || list[0].Code != second {
		t.Fatalf("after joining: %+v", list)
	}
	// Nor one no one came for
	now = now.Add(lifetime + time.Second)
	if list := invitations.List(); len(list) != 0 {
		t.Fatalf("after their time: %+v", list)
	}
}
