package dts

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func mdsDoc() *Doc {
	return &Doc{Races: []Race{{ID: "3", Start: time.Date(2026, 11, 8, 17, 30, 0, 0, time.UTC)}}}
}

func TestExportMDSNewWritesDelimitedLinesForAddedRacersOnly(t *testing.T) {
	entries := []Entry{
		{ID: "10000001@3", Licence: "10000001", RaceID: "3", Cap: "7"},
		{ID: "b", RaceID: "3", Cap: "W81", T1: "AB-12345", T2: "AB-54321", Added: true, Name: "Zoë van der Berg"},
		{ID: "c", RaceID: "3", Cap: "X3", Added: true, Name: "Jan"},
		{ID: "n1", Licence: "10000009", RaceID: "3", Cap: "12", T2: "AB-99999"},
	}
	out, n, err := mdsDoc().ExportMDSNew(entries, "")
	if err != nil || n != 3 {
		t.Fatalf("n = %d, err = %v", n, err)
	}
	lines := strings.Split(strings.TrimSuffix(string(out), "\r\n"), "\r\n")
	want := []string{
		`"W81";"ZZ00001";"";"AB-12345";"AB-54321";"Zoe van der Berg"`,
		`"X3";"ZZ00002";"";"";"";"Jan"`,
		`"12";"10000009";"";"";"AB-99999";""`,
	}
	for i, w := range want {
		if lines[i] != w {
			t.Errorf("line %d = %q, want %q", i, lines[i], w)
		}
	}
}

func TestExportMDSNewCutsALongNameAndKeepsQuotesOutOfTheFields(t *testing.T) {
	long := strings.Repeat("Abcdefghi ", 6)
	out, _, err := mdsDoc().ExportMDSNew([]Entry{{RaceID: "3", Cap: "1", Added: true, Name: long}, {RaceID: "3", Cap: "2", Added: true, Name: `Jan "de" Man`}}, "")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(out), "\r\n"), "\r\n")
	if want := `"` + strings.TrimSpace(long)[:45] + `"`; !strings.HasSuffix(lines[0], ";"+want) {
		t.Errorf("long name: %q", lines[0])
	}
	if !strings.HasSuffix(lines[1], `;"Jan 'de' Man"`) {
		t.Errorf("quotes: %q", lines[1])
	}
}

func TestExportMDSNewRefusesWhatDoesNotFit(t *testing.T) {
	for _, e := range []Entry{
		{RaceID: "3", Cap: "12345", Added: true, Name: "A"},
		{RaceID: "3", Cap: "1", T1: strings.Repeat("A", 26), Added: true, Name: "A"},
		{RaceID: "3", Cap: "1", Added: true},
	} {
		if _, _, err := mdsDoc().ExportMDSNew([]Entry{e}, ""); !errors.Is(err, ErrInvalid) {
			t.Errorf("%+v: err = %v", e, err)
		}
	}
}
