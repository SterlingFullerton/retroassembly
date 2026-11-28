// Package together introduces two browsers that are to play a game together: the host's, which runs it, and a
// guest's. The host leaves an invitation and gets a short code for it; the guest finds the invitation by the code and
// leaves an answer, which the host collects. After that the two talk straight to each other, and the server has no
// further part. Nothing is kept: an invitation lives in memory while its host waits for a guest, and is gone when the
// server restarts.
package together

import (
	"context"
	"crypto/rand"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"retroassembly/server/internal/failure"
)

const (
	// How long an invitation lasts after its host last asked for the answer. The host's browser asks again as soon as
	// it's told to, so this is only reached once the host has gone: closed the game, or lost the connection
	lifetime = time.Minute
	// How long the guest who found an invitation has it to themselves, to answer it: their browser answers within
	// seconds. Only they are given the host's offer, which says where the host's device can be reached
	reservation = time.Minute
	// Far more than a household plays at once: a limit on what a signed-in user can make the server remember
	maxInvitations = 100
	// A browser's offer or answer is a few thousand characters
	maxTextLength = 64 << 10
	codeLength    = 6
	// Letters and digits that can't be taken for one another when read out or typed
	alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

var (
	ErrNotFound = failure.New(http.StatusNotFound, "No game to join by that code")
	ErrAnswered = failure.New(http.StatusConflict, "Someone has already joined that game")
	ErrJoining  = failure.New(http.StatusConflict, "Someone else is joining that game")
	ErrTooMany  = failure.New(http.StatusTooManyRequests, "Too many games are being shared")
	ErrTooLong  = failure.New(http.StatusRequestEntityTooLarge, "Too long")
)

// Invitation is what a host leaves for a guest: how to reach the game, and what it is
type Invitation struct {
	// The console's on-screen controls, by name, for a guest on a touch screen
	Controls string `json:"controls"`
	// The console and the emulator the game is played with, for the guest's keys to be the ones they'd play it with
	Core     string `json:"core,omitempty"`
	Platform string `json:"platform,omitempty"`
	// The host's name, for a guest choosing among games
	Host  string `json:"host"`
	Offer string `json:"offer"`
	Title string `json:"title"`
	// Whether the game is shown to everyone signed in, to join without a code. Otherwise only its code finds it
	Listed bool `json:"-"`
	// A console of a linked pair on the server, which has no save states; for the starter's, the code that joins the
	// friend's console
	Linked     bool   `json:"linked,omitempty"`
	FriendCode string `json:"friendCode,omitempty"`
	// A game on the server that the player looking it up started, so they get its starter's menu however they came back
	// to it. Never taken from a person's own invitation
	StartedHere bool `json:"startedHere,omitempty"`
}

// Listing is a game shown to everyone signed in: what it is, whose, and the code that joins it
type Listing struct {
	Code     string `json:"code"`
	Controls string `json:"controls"`
	Host     string `json:"host"`
	Title    string `json:"title"`
}

// Guest is who answers an invitation: their account, and its name, which the host is told
type Guest struct {
	ID   string
	Name string
}

type waiting struct {
	Invitation
	hostID string
	answer string
	// Who answered, or, before the answer, who found the invitation and has it to themselves until reservedUntil
	guest         Guest
	reservedUntil time.Time
	// Closed when the answer arrives
	answered chan struct{}
	expires  time.Time
}

// Invitations is the invitations waiting for a guest, by code
type Invitations struct {
	mu      sync.Mutex
	waiting map[string]*waiting
	now     func() time.Time
}

func New() *Invitations {
	return &Invitations{waiting: map[string]*waiting{}, now: time.Now}
}

func newCode() string {
	bytes := make([]byte, codeLength)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	for i, b := range bytes {
		// The alphabet has 32 letters, so each of a byte's values lands on one evenly
		bytes[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(bytes)
}

// Normalize is a code as it's kept, however the guest typed it: letters in either case, with or without spaces
func Normalize(code string) string {
	return strings.ToUpper(strings.Join(strings.Fields(code), ""))
}

// forget drops the invitations no guest came for in time. Called with the lock held
func (i *Invitations) forget() {
	now := i.now()
	for code, each := range i.waiting {
		if now.After(each.expires) {
			delete(i.waiting, code)
		}
	}
}

// Open leaves a host's invitation and returns its code. A host shares one game at a time: an earlier invitation of
// theirs is withdrawn
func (i *Invitations) Open(hostID string, invitation Invitation) (string, error) {
	if len(invitation.Offer) > maxTextLength || len(invitation.Title) > maxTextLength || len(invitation.Controls) > maxTextLength ||
		len(invitation.Host) > maxTextLength {
		return "", ErrTooLong
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	i.forget()
	for code, each := range i.waiting {
		if each.hostID == hostID {
			delete(i.waiting, code)
		}
	}
	if len(i.waiting) >= maxInvitations {
		return "", ErrTooMany
	}
	code := newCode()
	for i.waiting[code] != nil {
		code = newCode()
	}
	i.waiting[code] = &waiting{
		Invitation: invitation, hostID: hostID, answered: make(chan struct{}), expires: i.now().Add(lifetime),
	}
	return code, nil
}

// List is the games anyone signed in may join, oldest first: those shown to everyone that no guest has joined yet
func (i *Invitations) List() []Listing {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.forget()
	type dated struct {
		Listing
		expires time.Time
	}
	found := []dated{}
	for code, each := range i.waiting {
		if each.Listed && each.answer == "" {
			found = append(found, dated{Listing{Code: code, Controls: each.Controls, Host: each.Host, Title: each.Title}, each.expires})
		}
	}
	sort.Slice(found, func(a, b int) bool {
		if found[a].expires.Equal(found[b].expires) {
			return found[a].Code < found[b].Code
		}
		return found[a].expires.Before(found[b].expires)
	})
	list := make([]Listing, len(found))
	for index, each := range found {
		list[index] = each.Listing
	}
	return list
}

// claim is the invitation under a code for a guest to answer, or why they can't: there's none, someone has answered,
// or someone else found it first and may still answer. Called with the lock held
func (i *Invitations) claim(code string, guest Guest) (*waiting, error) {
	i.forget()
	found := i.waiting[Normalize(code)]
	if found == nil {
		return nil, ErrNotFound
	}
	if found.answer != "" {
		return nil, ErrAnswered
	}
	if found.guest.ID != "" && found.guest.ID != guest.ID && i.now().Before(found.reservedUntil) {
		return nil, ErrJoining
	}
	return found, nil
}

// Find is the invitation left under a code, for a guest who means to answer it. It's theirs alone to answer for a
// while: no one else is given it meanwhile, nor once it's answered
func (i *Invitations) Find(code string, guest Guest) (Invitation, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	found, err := i.claim(code, guest)
	if err != nil {
		return Invitation{}, err
	}
	found.guest, found.reservedUntil = guest, i.now().Add(reservation)
	return found.Invitation, nil
}

// Answer leaves a guest's answer for the host: the guest who found the invitation, or anyone once their time to answer
// has passed. Only one guest joins
func (i *Invitations) Answer(code string, guest Guest, answer string) error {
	if len(answer) > maxTextLength {
		return ErrTooLong
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	found, err := i.claim(code, guest)
	if err != nil {
		return err
	}
	found.answer, found.guest = answer, guest
	close(found.answered)
	return nil
}

// WaitForAnswer gives the host the guest's answer and who the guest is, waiting up to the given time for one. With
// none by then it returns "", for the host to ask again. Only the host who left the invitation may collect its answer;
// once collected, the invitation is gone. A host waiting keeps the invitation open: it lasts while they ask
func (i *Invitations) WaitForAnswer(ctx context.Context, code, hostID string, wait time.Duration) (string, Guest, error) {
	code = Normalize(code)
	i.mu.Lock()
	i.forget()
	found := i.waiting[code]
	if found != nil && found.hostID == hostID {
		found.expires = i.now().Add(wait + lifetime)
	}
	i.mu.Unlock()
	if found == nil || found.hostID != hostID {
		return "", Guest{}, ErrNotFound
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-found.answered:
	case <-timer.C:
		i.mu.Lock()
		found.expires = i.now().Add(lifetime)
		i.mu.Unlock()
		return "", Guest{}, nil
	case <-ctx.Done():
		return "", Guest{}, ctx.Err()
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.waiting[code] == found {
		delete(i.waiting, code)
	}
	return found.answer, found.guest, nil
}

// Close withdraws a host's invitation
func (i *Invitations) Close(code, hostID string) {
	code = Normalize(code)
	i.mu.Lock()
	defer i.mu.Unlock()
	if found := i.waiting[code]; found != nil && found.hostID == hostID {
		delete(i.waiting, code)
	}
}
