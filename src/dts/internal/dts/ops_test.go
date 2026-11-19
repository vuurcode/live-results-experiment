package dts

import (
	"slices"
	"testing"
)

func TestReplaySingleFields(t *testing.T) {
	d := mustParse(t)
	entries, rej := d.Replay([]Op{
		{ID: "a", At: at(1), Kind: OpSign, Entry: "1001@3", Value: "1"},
		{ID: "b", At: at(2), Kind: OpCap, Entry: "1001@3", Value: "W81"},
		{ID: "c", At: at(3), Kind: OpT2, Entry: "1001@3", Value: "DD-44444"},
		{ID: "d", At: at(4), Kind: OpT2, Entry: "1002@3", Value: ""},
		{ID: "e", At: at(5), Kind: OpRace, Entry: "1003@13", Value: "3"},
	})
	if len(rej) != 0 {
		t.Fatalf("rejected %+v", rej)
	}
	e := entries[0]
	if !e.Signed || !e.SignedAt.Equal(at(1)) || e.Cap != "W81" || e.T2 != "DD-44444" || e.T1 != "AA-11111" {
		t.Errorf("%+v", e)
	}
	if entries[1].T2 != "" || entries[1].T1 != "AA-22222" {
		t.Errorf("removing transponder 2 must leave transponder 1: %+v", entries[1])
	}
	if entries[2].RaceID != "3" || entries[2].ID != "1003@13" {
		t.Errorf("a moved entry keeps its id: %+v", entries[2])
	}
	if d.Entries[0].Signed {
		t.Error("the document must not change")
	}
}

func TestReplayIsOrderIndependentAndIdempotent(t *testing.T) {
	d := mustParse(t)
	ops := []Op{
		{ID: "a", At: at(1), Kind: OpCap, Entry: "1001@3", Value: "5"},
		{ID: "b", At: at(2), Kind: OpCap, Entry: "1001@3", Value: "6"},
		{ID: "c", At: at(3), Kind: OpSign, Entry: "1002@3", Value: "0"},
	}
	want, _ := d.Replay(ops)
	rev := slices.Clone(ops)
	slices.Reverse(rev)
	got, _ := d.Replay(append(rev, ops...))
	if !slices.Equal(want, got) || want[0].Cap != "6" {
		t.Errorf("want %+v got %+v", want, got)
	}
}

func TestReplayRejects(t *testing.T) {
	d := mustParse(t)
	_, rej := d.Replay([]Op{
		{ID: "a", At: at(1), Kind: OpCap, Entry: "nobody@3", Value: "5"},
		{ID: "b", At: at(2), Kind: OpCap, Entry: "1001@3", Value: "1234"},
		{ID: "c", At: at(3), Kind: OpRace, Entry: "1001@3", Value: "99"},
	})
	if len(rej) != 3 {
		t.Fatalf("%+v", rej)
	}
}

func TestAddRacer(t *testing.T) {
	d := mustParse(t)
	entries, rej := d.Replay([]Op{
		{ID: "n1", At: at(1), Kind: OpAddRacer, Who: "1003", Race: "3", Cap: "X2", T1: "EE-55555", Signed: true},
		{ID: "n2", At: at(2), Kind: OpAddRacer, Who: "New Person", Race: "13", Cap: "X3", T1: "FF-66666"},
	})
	if len(rej) != 0 || len(entries) != 5 {
		t.Fatalf("%+v %d", rej, len(entries))
	}
	if e := entries[3]; e.Added || e.Licence != "1003" || e.Name != "Rider Three" || !e.Signed {
		t.Errorf("a known licence number uses that rider: %+v", e)
	}
	if e := entries[4]; !e.Added || e.Licence != "" || e.Name != "New Person" {
		t.Errorf("a free-form name is an added racer: %+v", e)
	}
}
