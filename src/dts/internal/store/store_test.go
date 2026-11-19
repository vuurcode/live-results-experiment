package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vuurcode/live-results-experiment/dts/internal/dts"
)

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<dataroot generated="2026-01-10T10:00:00">
<DTS_Wedstrijd><WedstrijdID>3</WedstrijdID><Start>2026-01-10T19:10:00</Start><CategorieCode>NO1</CategorieCode></DTS_Wedstrijd>
<DTS_Licentiehouder><Wedstrijdnummer>1001</Wedstrijdnummer><Naam>Rider One</Naam></DTS_Licentiehouder>
<DTS_Deelname><Wedstrijdnummer>1001</Wedstrijdnummer><WedstrijdID>3</WedstrijdID><ShowNr>11</ShowNr><Transponder1>AA-11111</Transponder1><Getekend>0</Getekend></DTS_Deelname>
</dataroot>
`

var now = time.Date(2026, 1, 10, 18, 0, 0, 0, time.UTC)

func newStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	clock := now
	s, err := New(Config{Dir: t.TempDir(), MaxSessions: 3, Retention: 7 * 24 * time.Hour, MaxUpload: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return clock }
	return s, &clock
}

func op(id string, mins int) dts.Op {
	return dts.Op{ID: id, At: now.Add(time.Duration(mins) * time.Minute), Kind: dts.OpCap, Entry: "1001@3", Value: "5"}
}

func TestCreateAndAuth(t *testing.T) {
	s, _ := newStore(t)
	id, sign, manage, err := s.Create([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if r, err := s.Auth(id, sign); err != nil || r != Sign {
		t.Errorf("sign key: %v %v", r, err)
	}
	if r, err := s.Auth(id, manage); err != nil || r != Manage {
		t.Errorf("manage key: %v %v", r, err)
	}
	for _, c := range [][2]string{{id, "wrong"}, {"0123456789abcdef0123456789abcdef", sign}, {"../x", sign}} {
		if _, err := s.Auth(c[0], c[1]); !errors.Is(err, ErrNotFound) {
			t.Errorf("%v: %v", c, err)
		}
	}
	// the manage key is not on disk in clear; the sign key is kept for the admin overview
	filepath.WalkDir(s.cfg.Dir, func(p string, d os.DirEntry, _ error) error {
		if !d.IsDir() {
			b, _ := os.ReadFile(p)
			if strings.Contains(string(b), manage) {
				t.Errorf("key in clear in %s", p)
			}
		}
		return nil
	})
}

func TestCreateRefusals(t *testing.T) {
	s, _ := newStore(t)
	if _, _, _, err := s.Create([]byte("nope")); !errors.Is(err, dts.ErrInvalid) {
		t.Errorf("%v", err)
	}
	s.cfg.MaxUpload = 10
	if _, _, _, err := s.Create([]byte(sample)); !errors.Is(err, ErrTooBig) {
		t.Errorf("%v", err)
	}
	s.cfg.MaxUpload = 1 << 20
	for range 3 {
		if _, _, _, err := s.Create([]byte(sample)); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := s.Create([]byte(sample)); !errors.Is(err, ErrFull) {
		t.Errorf("%v", err)
	}
}

func TestAppendIsIdempotentAndSurvivesReopen(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, _ := s.Create([]byte(sample))
	if n, err := s.AppendOps(id, []dts.Op{op("a", 1), op("b", 2)}); err != nil || n != 2 {
		t.Fatalf("%d %v", n, err)
	}
	if n, _ := s.AppendOps(id, []dts.Op{op("a", 1), op("c", 3)}); n != 1 {
		t.Errorf("a repeated id must be skipped, stored %d", n)
	}
	if _, err := s.AppendOps(id, []dts.Op{{ID: "bad", At: now, Kind: dts.OpCap, Entry: "1001@3", Value: "1234"}}); !errors.Is(err, dts.ErrInvalid) {
		t.Errorf("%v", err)
	}
	if _, err := s.AppendActions(id, []Action{{ID: "x", At: now, Kind: "cap", Old: "11", New: "5"}}); err != nil {
		t.Fatal(err)
	}
	re, _ := New(s.cfg)
	re.Now = s.Now
	got, err := re.Load(id)
	if err != nil || len(got.Ops) != 3 || len(got.Actions) != 1 || got.Meta.Changed.IsZero() || got.Meta.Synced.IsZero() {
		t.Fatalf("%v %+v", err, got)
	}
}

func TestNotesAndCutoff(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, _ := s.Create([]byte(sample))
	add := NoteEvent{ID: "n1", At: now, Kind: "add", Entry: "1001@3", Level: LevelWarning, Text: "payment due", By: "manage"}
	if err := s.AddNoteEvent(id, add); err != nil {
		t.Fatal(err)
	}
	if err := s.AddNoteEvent(id, add); err != nil {
		t.Fatal(err)
	}
	if err := s.AddNoteEvent(id, NoteEvent{ID: "n2", At: now, Kind: "resolve", NoteID: "n1", By: "sign"}); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []NoteEvent{
		{ID: "n3", At: now, Kind: "add", Entry: "1001@3", Level: "loud", Text: "x", By: "sign"},
		{ID: "n4", At: now, Kind: "add", Entry: "1001@3", Level: LevelNote, Text: strings.Repeat("x", 201), By: "sign"},
	} {
		if err := s.AddNoteEvent(id, bad); !errors.Is(err, dts.ErrInvalid) {
			t.Errorf("%v", err)
		}
	}
	got, _ := s.Load(id)
	if len(got.Notes) != 2 {
		t.Errorf("%d note events", len(got.Notes))
	}

	if s.Cutoff(got.Meta, "3") != 30 {
		t.Error("default cutoff")
	}
	if err := s.SetCutoff(id, "3", 45); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Load(id)
	if s.Cutoff(got.Meta, "3") != 45 {
		t.Error("set cutoff")
	}
	if err := s.SetCutoff(id, "3", -1); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Load(id)
	if s.Cutoff(got.Meta, "3") != 30 {
		t.Error("reset cutoff")
	}
	if !errors.Is(s.SetCutoff(id, "99", 10), dts.ErrInvalid) || !errors.Is(s.SetCutoff(id, "3", 241), dts.ErrInvalid) {
		t.Error("cutoff limits")
	}
}

func TestRetention(t *testing.T) {
	s, clock := newStore(t)
	id, sign, _, _ := s.Create([]byte(sample))
	*clock = clock.Add(6 * 24 * time.Hour)
	if _, err := s.Load(id); err != nil { // a use renews the week
		t.Fatal(err)
	}
	*clock = clock.Add(6 * 24 * time.Hour)
	if _, err := s.Auth(id, sign); err != nil {
		t.Fatalf("still within a week of the last use: %v", err)
	}
	*clock = clock.Add(8 * 24 * time.Hour)
	if _, err := s.Auth(id, sign); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired: %v", err)
	}
	if n := s.Sweep(); n != 1 {
		t.Errorf("swept %d", n)
	}
}

func TestRestore(t *testing.T) {
	s, _ := newStore(t)
	id, sign, manage, _ := s.Create([]byte(sample))
	s.AppendOps(id, []dts.Op{op("a", 1)})
	_ = os.RemoveAll(s.path(id, "")) // the host lost it

	if err := s.Restore(id, sign, HashKey(manage), []byte(sample), []dts.Op{op("a", 1), op("b", 2)}, []Action{{ID: "x", At: now, Kind: "cap"}}); err != nil {
		t.Fatal(err)
	}
	if r, err := s.Auth(id, manage); err != nil || r != Manage {
		t.Errorf("the manage link must work again: %v %v", r, err)
	}
	got, _ := s.Load(id)
	if len(got.Ops) != 2 || len(got.Actions) != 1 {
		t.Errorf("%+v", got)
	}
	// a second restore merges, and another sign key is refused
	if err := s.Restore(id, sign, HashKey(manage), []byte(sample), []dts.Op{op("c", 3)}, nil); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Load(id); len(got.Ops) != 3 {
		t.Errorf("%d", len(got.Ops))
	}
	if err := s.Restore(id, "other", HashKey(manage), []byte(sample), nil, nil); !errors.Is(err, ErrConflict) {
		t.Errorf("%v", err)
	}
	if err := s.Restore("short", sign, HashKey(manage), []byte(sample), nil, nil); !errors.Is(err, dts.ErrInvalid) {
		t.Errorf("%v", err)
	}
}

func TestDeleteIsRemembered(t *testing.T) {
	s, _ := newStore(t)
	id, sign, manage, _ := s.Create([]byte(sample))
	if got := s.List(); len(got) != 1 || got[0].ID != id || len(got[0].Races) != 1 {
		t.Fatalf("%+v", got)
	}
	if err := s.Remove(id); err != nil {
		t.Fatal(err)
	}
	if got := s.List(); len(got) != 0 {
		t.Errorf("%+v", got)
	}
	if err := s.Restore(id, sign, HashKey(manage), []byte(sample), nil, nil); !errors.Is(err, ErrGone) {
		t.Errorf("a deleted session must not come back: %v", err)
	}
}

func TestDeviceNameLimitCountsCharacters(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, err := s.Create([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Sync(id, SyncRequest{Device: "d1", Name: strings.Repeat("é", 40)}); err != nil {
		t.Errorf("40 accented characters: %v", err)
	}
	if _, err := s.Sync(id, SyncRequest{Device: "d1", Name: strings.Repeat("é", 41)}); !errors.Is(err, dts.ErrInvalid) {
		t.Errorf("41 characters: %v", err)
	}
}

func TestSignInKeepsTheSignKeyOfAnOlderSession(t *testing.T) {
	s, _ := newStore(t)
	id, sign, _, err := s.Create([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	m, _ := s.readMeta(id)
	m.SignKey = ""
	if err := s.writeMetaKeepingTime(id, m); err != nil {
		t.Fatal(err)
	}
	if got := s.List()[0].SignKey; got != "" {
		t.Fatalf("key before sign-in = %q", got)
	}
	if _, err := s.Auth(id, sign); err != nil {
		t.Fatal(err)
	}
	if got := s.List()[0].SignKey; got != sign {
		t.Fatalf("key after sign-in = %q, want %q", got, sign)
	}
}

func TestRestoreAfterDeleteKeepsTheManageKeyAndClosedRaces(t *testing.T) {
	s, _ := newStore(t)
	id, sign, manage, _ := s.Create([]byte(sample))
	if err := s.SetClosed(id, "3", true); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(id); err != nil {
		t.Fatal(err)
	}
	if err := s.Restore(id, sign, HashKey("another"), []byte(sample), nil, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("a restore with another manage key: %v", err)
	}
	if err := s.Restore(id, sign, HashKey(manage), []byte(sample), nil, nil); err != nil {
		t.Fatal(err)
	}
	if role, err := s.Auth(id, manage); err != nil || role != Manage {
		t.Errorf("manage key after restore: %v %v", role, err)
	}
	sess, err := s.Load(id)
	if err != nil || !sess.Meta.Closed["3"] {
		t.Errorf("the closed race must stay closed: %v %+v", err, sess.Meta.Closed)
	}
}

func TestSyncMarksActionsAsFromTheSignSide(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, _ := s.Create([]byte(sample))
	res, err := s.Sync(id, SyncRequest{Device: "d1", Actions: []Action{{ID: "a1", At: now, Kind: "sign", By: "sysadmin"}}})
	if err != nil || len(res.Actions) != 1 || res.Actions[0].By != "sign" {
		t.Errorf("%v %+v", err, res.Actions)
	}
	long := strings.Repeat("x", maxText+1)
	if _, err := s.AppendActions(id, []Action{{ID: "a2", At: now, Kind: "note", Text: long}}); !errors.Is(err, dts.ErrInvalid) {
		t.Errorf("a long action text: %v", err)
	}
}

func TestATornLastLineDoesNotLockTheSession(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, _ := s.Create([]byte(sample))
	if _, err := s.AppendOps(id, []dts.Op{op("o1", 1)}); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(s.path(id, "ops.jsonl"), os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.WriteString(`{"id":"o2","at":"2026-01`)
	_ = f.Close()
	sess, err := s.Load(id)
	if err != nil || len(sess.Ops) != 1 {
		t.Fatalf("a torn last line: %v %d", err, len(sess.Ops))
	}
	if _, err := s.AppendOps(id, []dts.Op{op("o2", 2)}); err != nil {
		t.Fatal(err)
	}
	if sess, err = s.Load(id); err != nil || len(sess.Ops) != 2 {
		t.Errorf("the next line must follow a whole one: %v %d", err, len(sess.Ops))
	}
}

func TestAnOperationTimeFarAheadIsClamped(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, _ := s.Create([]byte(sample))
	if _, err := s.AppendOps(id, []dts.Op{op("o1", 60*24*365)}); err != nil {
		t.Fatal(err)
	}
	sess, _ := s.Load(id)
	if got := sess.Ops[0].At; got.After(now.Add(maxAhead)) {
		t.Errorf("%v", got)
	}
}

func TestSyncStoresNothingWhenOneLineIsInvalid(t *testing.T) {
	s, _ := newStore(t)
	id, _, _, _ := s.Create([]byte(sample))
	_, err := s.Sync(id, SyncRequest{Device: "d1", Ops: []dts.Op{op("o1", 1)}, Actions: []Action{{ID: "", At: now, Kind: "x"}}})
	if !errors.Is(err, dts.ErrInvalid) {
		t.Fatal(err)
	}
	if sess, _ := s.Load(id); len(sess.Ops) != 0 {
		t.Errorf("%d operations stored", len(sess.Ops))
	}
}

func TestAClosedRaceStaysClosedToARacerAddedUnderTheIdOfOneOfItsEntries(t *testing.T) {
	s, _ := newStore(t)
	two := strings.Replace(sample, "<DTS_Licentiehouder>", `<DTS_Wedstrijd><WedstrijdID>4</WedstrijdID><Start>2026-01-10T20:10:00</Start><CategorieCode>NO2</CategorieCode></DTS_Wedstrijd>
<DTS_Licentiehouder>`, 1)
	id, _, _, _ := s.Create([]byte(two))
	if err := s.SetClosed(id, "3", true); err != nil {
		t.Fatal(err)
	}
	// one batch: a racer added to the open race under the id of an entry of the closed one, then a change to that id
	add := dts.Op{ID: "1001@3", At: now, Kind: dts.OpAddRacer, Who: "Someone", Race: "4", Cap: "X1", T1: "AA-12345"}
	sign := dts.Op{ID: "s1", At: now.Add(time.Second), Kind: dts.OpSign, Entry: "1001@3", Value: "1"}
	if _, err := s.AppendOps(id, []dts.Op{add, sign}); err != nil {
		t.Fatal(err)
	}
	sess, err := s.Load(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range sess.Ops {
		if o.ID == "s1" {
			t.Errorf("the change to an entry of a closed race was stored: %+v", o)
		}
	}
}
