package dts

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// sampleXML is a generated export: two races, three riders, no real data.
func sampleXML() []byte {
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<dataroot xmlns:od="urn:schemas-microsoft-com:officedata" generated="2026-01-10T10:00:00">` + "\n")
	for _, r := range [][4]string{{"3", "NO1", "NO-1", "2026-01-10T19:10:00"}, {"13", "NO2", "NO-2", "2026-01-10T17:30:00"}} {
		fmt.Fprintf(&b, "<DTS_Wedstrijd><WedstrijdID>%s</WedstrijdID><Start>%s</Start><CategorieCode>%s</CategorieCode><Naam>%s</Naam></DTS_Wedstrijd>\n", r[0], r[3], r[1], r[2])
	}
	for _, r := range [][3]string{{"1001", "Rider One", "Town A"}, {"1002", "Rider Two", "Town B"}, {"1003", "Rider Three", "Town C"}} {
		fmt.Fprintf(&b, "<DTS_Licentiehouder><Wedstrijdnummer>%s</Wedstrijdnummer><Naam>%s</Naam><Woonplaats>%s</Woonplaats><CategorieCode>M</CategorieCode><ValidTo>2026-12-31</ValidTo></DTS_Licentiehouder>\n", r[0], r[1], r[2])
	}
	b.WriteString("<DTS_Deelname><Wedstrijdnummer>1001</Wedstrijdnummer><WedstrijdID>3</WedstrijdID><ShowNr>11</ShowNr><Transponder1>AA-11111</Transponder1><Getekend>0</Getekend></DTS_Deelname>\n")
	b.WriteString("<DTS_Deelname><Wedstrijdnummer>1002</Wedstrijdnummer><WedstrijdID>3</WedstrijdID><ShowNr>12</ShowNr><Transponder1>AA-22222</Transponder1><Transponder2>BB-22222</Transponder2><Getekend>1</Getekend></DTS_Deelname>\n")
	b.WriteString("<DTS_Deelname><Wedstrijdnummer>1003</Wedstrijdnummer><WedstrijdID>13</WedstrijdID><ShowNr>X1</ShowNr><Transponder2>CC-33333</Transponder2><Getekend>0</Getekend></DTS_Deelname>\n")
	b.WriteString("</dataroot>\n")
	return []byte(b.String())
}

func mustParse(t *testing.T) *Doc {
	t.Helper()
	d, err := Parse(sampleXML())
	if err != nil {
		t.Fatal(err)
	}
	return d
}

var t0 = time.Date(2026, 1, 10, 17, 0, 0, 0, time.UTC)

func at(mins int) time.Time { return t0.Add(time.Duration(mins) * time.Minute) }
