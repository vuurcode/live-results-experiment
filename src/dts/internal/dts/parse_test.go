package dts

import (
	"errors"
	"testing"
)

func TestParse(t *testing.T) {
	d := mustParse(t)
	if len(d.Races) != 2 || len(d.Riders) != 3 || len(d.Entries) != 3 {
		t.Fatalf("got %d races, %d riders, %d entries", len(d.Races), len(d.Riders), len(d.Entries))
	}
	if got := d.Races[1].Start.Format("15:04"); got != "17:30" {
		t.Errorf("start %s", got)
	}
	e := d.Entries[1]
	if e.ID != "1002@3" || e.Cap != "12" || e.T1 != "AA-22222" || e.T2 != "BB-22222" || !e.Signed {
		t.Errorf("entry %+v", e)
	}
	if d.Entries[2].T1 != "" || d.Entries[2].T2 != "CC-33333" {
		t.Errorf("a lone transponder in slot 2 must stay in slot 2: %+v", d.Entries[2])
	}
}

func TestParseRefuses(t *testing.T) {
	for name, in := range map[string]string{
		"not xml":    "hello",
		"wrong root": "<other></other>",
		"no races":   "<dataroot></dataroot>",
		"bad start":  "<dataroot><DTS_Wedstrijd><WedstrijdID>1</WedstrijdID><Start>x</Start></DTS_Wedstrijd></dataroot>",
	} {
		if _, err := Parse([]byte(in)); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestValidators(t *testing.T) {
	for _, s := range []string{"7", "123", "X3", "W81"} {
		if !ValidCap(s) {
			t.Errorf("cap %q should be valid", s)
		}
	}
	for _, s := range []string{"", "1234", "x3", "XY1", "X", "1 "} {
		if ValidCap(s) {
			t.Errorf("cap %q should be invalid", s)
		}
	}
	if !ValidTransponder("AB-12345") || ValidTransponder("AB12345") || ValidTransponder("ab-12345") || ValidTransponder("AB-1234") {
		t.Error("transponder format")
	}
}

func TestImportedNotesFromMeldingen(t *testing.T) {
	src := `<dataroot>
<DTS_Wedstrijd><WedstrijdID>3</WedstrijdID><Start>2026-01-10T17:30:00</Start></DTS_Wedstrijd>
<DTS_Licentiehouder><Wedstrijdnummer>1001</Wedstrijdnummer><Naam>A</Naam><Melding>Van  vorig seizoen</Melding><InschrijvenBijJury>-1</InschrijvenBijJury></DTS_Licentiehouder>
<DTS_Licentiehouder><Wedstrijdnummer>1002</Wedstrijdnummer><Naam>B</Naam></DTS_Licentiehouder>
<DTS_Deelname><Wedstrijdnummer>1001</Wedstrijdnummer><WedstrijdID>3</WedstrijdID><ShowNr>1</ShowNr></DTS_Deelname>
<DTS_Deelname><Wedstrijdnummer>1002</Wedstrijdnummer><WedstrijdID>3</WedstrijdID><ShowNr>2</ShowNr><Melding>Eigen</Melding></DTS_Deelname>
</dataroot>`
	d, err := Parse([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	got := d.ImportedNotes()
	if len(got) != 2 || got[0].ID != "melding:1001@3" || got[0].Text != "Van vorig seizoen" || !got[0].Warning || got[0].At.IsZero() ||
		got[1].Entry != "1002@3" || got[1].Text != "Eigen" || got[1].Warning {
		t.Errorf("%+v", got)
	}
}
