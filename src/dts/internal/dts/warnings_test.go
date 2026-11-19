package dts

import (
	"slices"
	"testing"
)

func TestWarnings(t *testing.T) {
	d := mustParse(t)
	if w := Warnings(d.Entries); len(w) != 0 {
		t.Fatalf("clean sample: %+v", w)
	}
	entries, _ := d.Replay([]Op{
		{ID: "a", At: at(1), Kind: OpCap, Entry: "1001@3", Value: "12"},       // same cap, same race
		{ID: "b", At: at(2), Kind: OpT1, Entry: "1001@3", Value: "BB-22222"},  // transponder 1 equals the other's transponder 2, same race
		{ID: "c", At: at(3), Kind: OpT1, Entry: "1003@13", Value: "AA-22222"}, // same transponder, other race
		{ID: "d", At: at(4), Kind: OpCap, Entry: "1003@13", Value: "11"},      // same cap, other race: no warning
	})
	got := map[string]int{}
	for _, w := range Warnings(entries) {
		got[w.Level+"/"+w.Kind+"/"+w.Value]++
	}
	want := map[string]int{
		"severe/cap/12":               1,
		"severe/transponder/BB-22222": 1,
		"light/transponder/AA-22222":  1,
	}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for k := range want {
		if got[k] != 1 {
			t.Errorf("missing %s in %v", k, got)
		}
	}
}

func TestWarningGoesAwayWhenFixed(t *testing.T) {
	d := mustParse(t)
	ops := []Op{{ID: "a", At: at(1), Kind: OpCap, Entry: "1001@3", Value: "12"}}
	entries, _ := d.Replay(ops)
	if len(Warnings(entries)) != 1 {
		t.Fatal("expected the collision")
	}
	entries, _ = d.Replay(append(ops, Op{ID: "b", At: at(2), Kind: OpCap, Entry: "1001@3", Value: "13"}))
	if w := Warnings(entries); len(w) != 0 {
		t.Errorf("%+v", w)
	}
}

func TestSameRiderInTwoRacesIsNoWarning(t *testing.T) {
	d := mustParse(t)
	entries, _ := d.Replay([]Op{{ID: "n", At: at(1), Kind: OpAddRacer, Who: "1001", Race: "13", Cap: "40", T1: "GG-77777"}})
	if w := Warnings(entries); len(w) != 0 {
		t.Errorf("%+v", w)
	}
}

func TestWarningsIgnoreTheSameRiderInTwoRaces(t *testing.T) {
	same := []Entry{
		{ID: "1@3", Licence: "1001", RaceID: "3", Cap: "1", T1: "AA-11111"},
		{ID: "1@13", Licence: "1001", RaceID: "13", Cap: "1", T1: "AA-11111"},
	}
	if w := Warnings(same); len(w) != 0 {
		t.Fatalf("one rider: %+v", w)
	}
	other := append(slices.Clone(same), Entry{ID: "2@13", Licence: "1002", RaceID: "13", Cap: "2", T1: "AA-11111"})
	if w := Warnings(other); len(w) == 0 {
		t.Fatal("two riders on one transponder must warn")
	}
}
