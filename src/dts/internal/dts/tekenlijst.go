package dts

import (
	"bytes"
	"encoding/xml"
	"strings"
	"time"
)

// ExportTekenlijst writes the sign list in the shape MDS reads back with "Tekenlijst verwerken": one
// Tekenlijst_Deelname row per signed entry with the columns of that table. MDS merges Getekend, the transponders and the
// low battery flags into its Deelname rows by licence number and race, so an entry without a licence number (a racer
// added by a typed name) can never match and is left out. An entry that is not signed is left out too: MDS reports
// every unsigned row of the file in its "Scan&Go tekenlijst" dialog, as if the rider were blocked. Both low battery
// columns are NOT NULL in MDS and are written as 0: the signer does not see a battery state.
func (d *Doc) ExportTekenlijst(entries []Entry, race string, now time.Time) []byte {
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<dataroot xmlns:od="urn:schemas-microsoft-com:officedata" generated="` + now.Format(startLayout) + `">` + "\n")
	for _, e := range wantedEntries(entries, race) {
		if e.Licence == "" || !e.Signed {
			continue
		}
		b.WriteString("<Tekenlijst_Deelname>\n")
		field := func(name, value string) {
			if value == "" {
				return
			}
			b.WriteString("<" + name + ">")
			_ = xml.EscapeText(&b, []byte(value))
			b.WriteString("</" + name + ">\n")
		}
		field("WedstrijdID", e.RaceID)
		field("Wedstrijdnummer", e.Licence)
		field("Getekend", "1")
		field("Transponder1", strings.TrimSpace(e.T1))
		field("Transponder1LowBat", "0")
		field("Transponder2", strings.TrimSpace(e.T2))
		field("Transponder2LowBat", "0")
		b.WriteString("</Tekenlijst_Deelname>\n")
	}
	b.WriteString("</dataroot>\n")
	return b.Bytes()
}
