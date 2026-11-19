package dts

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

const startLayout = "2006-01-02T15:04:05"

// Parse reads a DTS export. The records are flat children of the root, each with its fields as child elements.
// A file without a single race, or that is not XML, is refused.
func Parse(data []byte) (*Doc, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	doc := &Doc{Riders: map[string]Rider{}}
	seenRoot := false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrInvalid, err)
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		if !seenRoot {
			seenRoot = true
			if start.Name.Local != "dataroot" {
				return nil, fmt.Errorf("%w: root element is %q, not dataroot", ErrInvalid, start.Name.Local)
			}
			continue
		}
		switch start.Name.Local {
		case "DTS_Wedstrijd", "DTS_Licentiehouder", "DTS_Deelname":
			fields, err := readFields(dec)
			if err != nil {
				return nil, fmt.Errorf("%w: %w", ErrInvalid, err)
			}
			if err := doc.add(start.Name.Local, fields); err != nil {
				return nil, err
			}
		default:
			if err := dec.Skip(); err != nil {
				return nil, fmt.Errorf("%w: %w", ErrInvalid, err)
			}
		}
	}
	if len(doc.Races) == 0 {
		return nil, fmt.Errorf("%w: no DTS_Wedstrijd records", ErrInvalid)
	}
	return doc, nil
}

func readFields(dec *xml.Decoder) (map[string]string, error) {
	fields := map[string]string{}
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			var text string
			if err := dec.DecodeElement(&text, &t); err != nil {
				return nil, err
			}
			fields[t.Name.Local] = strings.TrimSpace(text)
		case xml.EndElement:
			return fields, nil
		}
	}
}

func (d *Doc) add(kind string, f map[string]string) error {
	switch kind {
	case "DTS_Wedstrijd":
		start, err := time.Parse(startLayout, f["Start"])
		if err != nil {
			return fmt.Errorf("%w: race %q has no valid Start", ErrInvalid, f["WedstrijdID"])
		}
		if f["WedstrijdID"] == "" {
			return fmt.Errorf("%w: race without WedstrijdID", ErrInvalid)
		}
		d.Races = append(d.Races, Race{ID: f["WedstrijdID"], Code: f["CategorieCode"], Name: f["Naam"], Place: f["Plaats"], Category: f["Categorie"], Start: start})
	case "DTS_Licentiehouder":
		d.Riders[f["Wedstrijdnummer"]] = Rider{
			Licence: f["Wedstrijdnummer"], Name: f["Naam"], Town: f["Woonplaats"],
			Sponsor: f["Sponsornaam"], Class: f["CategorieCode"], ValidTo: f["ValidTo"],
			Melding: f["Melding"], Jury: yes(f["InschrijvenBijJury"]),
		}
	case "DTS_Deelname":
		e := Entry{
			ID: f["Wedstrijdnummer"] + "@" + f["WedstrijdID"], Licence: f["Wedstrijdnummer"], RaceID: f["WedstrijdID"],
			Cap: f["ShowNr"], T1: f["Transponder1"], T2: f["Transponder2"], Signed: f["Getekend"] == "1",
			Melding: f["Melding"], Jury: yes(f["InschrijvenBijJury"]),
		}
		d.Entries = append(d.Entries, e)
	}
	return nil
}

// yes reads an Access yes/no value: 1 or -1 (or true) is yes.
func yes(s string) bool { return s == "1" || s == "-1" || strings.EqualFold(s, "true") }

// ImportedNote is a notice (melding) that came with the file, as a note about an entry.
type ImportedNote struct {
	ID, Entry, Text string
	Warning         bool
	// At is the start of the entry's race: the notice has no time of its own.
	At time.Time
}

// MaxNoteSize is the longest text of a note; a longer notice from the file is cut to it.
const MaxNoteSize = 200

// ImportedNotes turns the notices of the file into notes: one per entry, from the entry's own notice or else that of
// its licence holder. A notice asking to register at the jury becomes a warning. The id is fixed by the entry so that
// resolving the note stays attached to it.
func (d *Doc) ImportedNotes() []ImportedNote {
	var out []ImportedNote
	for _, e := range d.Entries {
		text, jury := e.Melding, e.Jury
		if text == "" {
			r := d.Riders[e.Licence]
			text, jury = r.Melding, r.Jury
		}
		text = strings.Join(strings.Fields(text), " ")
		if text == "" {
			continue
		}
		if r := []rune(text); len(r) > MaxNoteSize {
			text = string(r[:MaxNoteSize])
		}
		race, _ := d.Race(e.RaceID)
		out = append(out, ImportedNote{ID: "melding:" + e.ID, Entry: e.ID, Text: text, Warning: jury, At: race.Start})
	}
	return out
}

// Race returns the race with the given id.
func (d *Doc) Race(id string) (Race, bool) {
	for _, r := range d.Races {
		if r.ID == id {
			return r, true
		}
	}
	return Race{}, false
}
