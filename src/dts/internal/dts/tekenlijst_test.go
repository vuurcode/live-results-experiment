package dts

import (
	"strings"
	"testing"
	"time"
)

func TestExportTekenlijstHoldsTheTableColumnsAndSkipsUnsignedEntriesAndEntriesMdsDoesNotHave(t *testing.T) {
	d := &Doc{}
	entries := []Entry{
		{ID: "10000001@3", Licence: "10000001", RaceID: "3", Cap: "7", T1: "AB-12345", Signed: true},
		{ID: "10000002@3", Licence: "10000002", RaceID: "3", Cap: "8", T2: "AB-<&>", Signed: true},
		{ID: "10000003@3", Licence: "10000003", RaceID: "3", Cap: "10", T1: "ZZ-1"},
		{ID: "c", RaceID: "3", Cap: "9", Added: true, Name: "Typed"},
		{ID: "x1", Licence: "10000004", RaceID: "3", Cap: "11", Added: true, Signed: true},
		{ID: "10000005@2", Licence: "10000005", RaceID: "3", Cap: "12", Signed: true},
	}
	out := string(d.ExportTekenlijst(entries, "", time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)))
	if n := strings.Count(out, "<Tekenlijst_Deelname>"); n != 2 {
		t.Fatalf("rows = %d, want 2:\n%s", n, out)
	}
	for _, want := range []string{
		"<Wedstrijdnummer>10000001</Wedstrijdnummer>", "<Getekend>1</Getekend>",
		"<Transponder1>AB-12345</Transponder1>", "<Transponder1LowBat>0</Transponder1LowBat>",
		"<Transponder2LowBat>0</Transponder2LowBat>", "<Transponder2>AB-&lt;&amp;&gt;</Transponder2>",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "ShowNr") || strings.Contains(out, "Typed") || strings.Contains(out, "10000003") || strings.Contains(out, "10000004") || strings.Contains(out, "10000005") || strings.Contains(out, "<Getekend>0") {
		t.Errorf("unexpected content:\n%s", out)
	}
}
