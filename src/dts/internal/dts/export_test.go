package dts

import (
	"strings"
	"testing"
)

var stamp = at(90)

func TestExportOnlyTouchesWhatChanged(t *testing.T) {
	d := mustParse(t)
	src := sampleXML()
	entries, _ := d.Replay([]Op{
		{ID: "a", At: at(1), Kind: OpSign, Entry: "1001@3", Value: "1"},
		{ID: "b", At: at(2), Kind: OpT2, Entry: "1001@3", Value: "DD-44444"},
		{ID: "c", At: at(3), Kind: OpT2, Entry: "1002@3", Value: ""},
		{ID: "d", At: at(4), Kind: OpCap, Entry: "1003@13", Value: "W81"},
	})
	out, sum, err := d.Export(src, entries, "", stamp)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Entries != 3 {
		t.Errorf("%+v", sum)
	}
	text := string(out)
	for _, want := range []string{
		`generated="2026-01-10T18:30:00"`,
		"<Transponder1>AA-11111</Transponder1><Transponder2>DD-44444</Transponder2><Getekend>1</Getekend>",
		"<Transponder1>AA-22222</Transponder1><Getekend>1</Getekend>",
		"<ShowNr>W81</ShowNr><Transponder2>CC-33333</Transponder2>",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in\n%s", want, text)
		}
	}
	if strings.Contains(text, "BB-22222") {
		t.Error("a removed transponder must be gone")
	}
	// the lines that did not change are the same bytes
	for _, l := range strings.Split(string(src), "\n") {
		if strings.HasPrefix(l, "<DTS_Wedstrijd>") || strings.HasPrefix(l, "<DTS_Licentiehouder>") {
			if !strings.Contains(text, l+"\n") {
				t.Errorf("changed: %s", l)
			}
		}
	}
}

func TestExportNoChangeKeepsEntryLines(t *testing.T) {
	d := mustParse(t)
	src := sampleXML()
	out, _, err := d.Export(src, d.Entries, "", t0)
	if err != nil {
		t.Fatal(err)
	}
	if a, b := strings.Split(string(src), "\n")[2:], strings.Split(string(out), "\n")[2:]; strings.Join(a, "\n") != strings.Join(b, "\n") {
		t.Errorf("an export without changes must equal the source apart from the stamp:\n%s", out)
	}
}

func TestExportKeepsCRLF(t *testing.T) {
	d := mustParse(t)
	src := []byte(strings.ReplaceAll(string(sampleXML()), "\n", "\r\n"))
	entries, _ := d.Replay([]Op{{ID: "a", At: at(1), Kind: OpCap, Entry: "1001@3", Value: "5"}})
	out, _, err := d.Export(src, entries, "", stamp)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(out), "\r\n") != strings.Count(string(out), "\n") {
		t.Error("line endings changed")
	}
}

func TestExportPerRace(t *testing.T) {
	d := mustParse(t)
	entries, _ := d.Replay([]Op{
		{ID: "a", At: at(1), Kind: OpRace, Entry: "1003@13", Value: "3"},
		{ID: "n", At: at(2), Kind: OpAddRacer, Who: "1001", Race: "13", Cap: "40", T1: "GG-77777"},
	})
	one, _, err := d.Export(sampleXML(), entries, "3", stamp)
	if err != nil {
		t.Fatal(err)
	}
	two, _, err := d.Export(sampleXML(), entries, "13", stamp)
	if err != nil {
		t.Fatal(err)
	}
	p1, _ := Parse(one)
	p2, _ := Parse(two)
	if len(p1.Races) != 1 || len(p1.Entries) != 3 || len(p2.Races) != 1 || len(p2.Entries) != 1 {
		t.Fatalf("race 3: %d entries, race 13: %d", len(p1.Entries), len(p2.Entries))
	}
	if _, ok := p2.Riders["1001"]; !ok || len(p2.Riders) != 1 {
		t.Errorf("a file holds the riders its entries need: %v", p2.Riders)
	}
	if !strings.Contains(string(two), "<Wedstrijdnummer>1001</Wedstrijdnummer><WedstrijdID>13</WedstrijdID><ShowNr>40</ShowNr>") {
		t.Errorf("new row missing:\n%s", two)
	}
	if _, _, err := d.Export(sampleXML(), entries, "99", stamp); err == nil {
		t.Error("unknown race")
	}
}

func TestExportWritesNewRidersWithoutLicenceNumber(t *testing.T) {
	d := mustParse(t)
	entries, _ := d.Replay([]Op{
		{ID: "n", At: at(1), Kind: OpAddRacer, Who: "New Person", Race: "3", Cap: "X9", T1: "HH-88888"},
		{ID: "m", At: at(2), Kind: OpAddRacer, Who: "10154197", Race: "3", Cap: "X8", T1: "HH-88889"},
	})
	for _, race := range []string{"", "3"} {
		out, sum, err := d.Export(sampleXML(), entries, race, stamp)
		if err != nil {
			t.Fatal(err)
		}
		text := string(out)
		if !strings.Contains(text, "<DTS_Deelname><WedstrijdID>3</WedstrijdID><ShowNr>X9</ShowNr><Transponder1>HH-88888</Transponder1><Getekend>0</Getekend></DTS_Deelname>") ||
			!strings.Contains(text, "<ShowNr>X8</ShowNr>") || strings.Contains(text, "New Person") || strings.Contains(text, "10154197") {
			t.Errorf("race %q: new riders are written with their start number and no licence number:\n%s", race, text)
		}
		if p, err := Parse(out); err != nil || len(p.Entries) != sum.Entries {
			t.Errorf("race %q: %v, %d entries for %d", race, err, len(p.Entries), sum.Entries)
		}
	}
}

func TestCheckCatchesADifference(t *testing.T) {
	d := mustParse(t)
	entries, _ := d.Replay([]Op{{ID: "a", At: at(1), Kind: OpCap, Entry: "1001@3", Value: "5"}})
	good, _, err := d.Export(sampleXML(), entries, "", stamp)
	if err != nil {
		t.Fatal(err)
	}
	bad := strings.Replace(string(good), "<ShowNr>5</ShowNr>", "<ShowNr>6</ShowNr>", 1)
	if err := d.check([]byte(bad), sampleXML(), entries, ""); err == nil {
		t.Error("a changed value must fail the check")
	}
}

// splitFields puts every element of every record on its own line, the way some DTS exports are written.
func splitFields(src []byte) []byte {
	lines := strings.Split(string(src), "\n")
	for i, l := range lines {
		if strings.HasPrefix(l, "<DTS_") {
			lines[i] = strings.ReplaceAll(l, "><", ">\n<")
		}
	}
	return []byte(strings.Join(lines, "\n"))
}

func TestExportRecordsOverSeveralLines(t *testing.T) {
	src := splitFields(sampleXML())
	d, err := Parse(src)
	if err != nil {
		t.Fatal(err)
	}
	out, _, err := d.Export(src, d.Entries, "", t0)
	if err != nil {
		t.Fatal(err)
	}
	if a, b := strings.Split(string(src), "\n")[2:], strings.Split(string(out), "\n")[2:]; strings.Join(a, "\n") != strings.Join(b, "\n") {
		t.Errorf("an export without changes must equal the source apart from the stamp:\n%s", out)
	}
	entries, _ := d.Replay([]Op{
		{ID: "a", At: at(1), Kind: OpSign, Entry: "1001@3", Value: "1"},
		{ID: "b", At: at(2), Kind: OpT2, Entry: "1001@3", Value: "DD-44444"},
		{ID: "c", At: at(3), Kind: OpT2, Entry: "1002@3", Value: ""},
	})
	out, _, err = d.Export(src, entries, "", stamp)
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	if !strings.Contains(text, "<Transponder2>DD-44444</Transponder2>\n<Getekend>1</Getekend>\n</DTS_Deelname>") {
		t.Errorf("a new field goes on its own line in its place:\n%s", text)
	}
	if strings.Contains(text, "BB-22222") || strings.Contains(text, "\n\n") {
		t.Errorf("a removed field leaves no trace and no empty line:\n%s", text)
	}
}

func TestExportPerRaceKeepsTheRaceRecord(t *testing.T) {
	d := mustParse(t)
	// every entry leaves race 13 and race 3 gains an entry; both race records must still be in their own file, unchanged
	entries, _ := d.Replay([]Op{{ID: "a", At: at(1), Kind: OpRace, Entry: "1003@13", Value: "3"}})
	for _, race := range []string{"3", "13"} {
		out, _, err := d.Export(sampleXML(), entries, race, stamp)
		if err != nil {
			t.Fatal(err)
		}
		var want string
		for _, l := range strings.SplitAfter(string(sampleXML()), "\n") {
			if strings.HasPrefix(l, "<DTS_Wedstrijd>") && strings.Contains(l, "<WedstrijdID>"+race+"</WedstrijdID>") {
				want = l
			}
		}
		if want == "" || !strings.Contains(string(out), want) {
			t.Errorf("race %s: record missing or changed:\n%s", race, out)
		}
		if p, err := Parse(out); err != nil || len(p.Races) != 1 {
			t.Errorf("race %s: %v %d races", race, err, len(p.Races))
		}
	}
}
