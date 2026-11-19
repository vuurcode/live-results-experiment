package dts

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// The field widths of the MDS text import of the Deelname tab (import spec "ImportBeennummer", table "Import: Beennummer").
// The file is delimited: per line the fields Beennummer, Wedstrijdnummer, Ploeg, Transponder1, Transponder2 and Naam, each
// in double quotes and separated by semicolons. The team is left empty.
const (
	mdsCapWidth     = 4
	mdsLicenceWidth = 8
	mdsTransWidth   = 25
	mdsNameWidth    = 45
)

// mdsASCII folds the letters of Western European names to ASCII: the file is read by MDS as Windows-1252, and the
// download passes through the browser as text, so only ASCII is safe.
var mdsASCII = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ã", "a", "ä", "a", "å", "a", "À", "A", "Á", "A", "Â", "A", "Ã", "A", "Ä", "A", "Å", "A",
	"è", "e", "é", "e", "ê", "e", "ë", "e", "È", "E", "É", "E", "Ê", "E", "Ë", "E",
	"ì", "i", "í", "i", "î", "i", "ï", "i", "Ì", "I", "Í", "I", "Î", "I", "Ï", "I",
	"ò", "o", "ó", "o", "ô", "o", "õ", "o", "ö", "o", "ø", "o", "Ò", "O", "Ó", "O", "Ô", "O", "Õ", "O", "Ö", "O", "Ø", "O",
	"ù", "u", "ú", "u", "û", "u", "ü", "u", "Ù", "U", "Ú", "U", "Û", "U", "Ü", "U",
	"ç", "c", "Ç", "C", "ñ", "n", "Ñ", "N", "ý", "y", "ÿ", "y", "Ý", "Y", "ß", "ss",
)

// newInRace says whether MDS does not have the entry in its race yet: a racer added during the day, or a rider of the
// file put in another race. The entries of the file are identified as licence number and race.
func newInRace(e Entry) bool {
	return e.Added || e.ID != e.Licence+"@"+e.RaceID
}

// ExportMDSNew writes the racers that were added during the day as lines for the text import of the Deelname tab in
// MDS. A racer without a licence number gets a placeholder one; MDS makes a licence holder of it from the name. Only
// added racers are written: the riders of the file are in MDS already, and MDS appends what it imports.
// A start number, transponder or licence number that does not fit its field is refused, never cut; a name is cut.
func (d *Doc) ExportMDSNew(entries []Entry, race string) ([]byte, int, error) {
	var out strings.Builder
	written := 0
	// A racer added without a licence number gets the next free ZZ number, counting from ZZ00001 over the whole list
	// (also the racers of other races, so that the numbers stay the same whichever race is exported) and skipping the
	// numbers that were typed for other racers.
	taken := map[string]bool{}
	for _, e := range entries {
		if e.NewLicence != "" {
			taken[e.NewLicence] = true
		}
	}
	next := 0
	for _, e := range entries {
		licence := e.Licence
		if e.Added && licence == "" && e.NewLicence != "" {
			licence = e.NewLicence
		} else if e.Added && licence == "" {
			for {
				next++
				licence = fmt.Sprintf("ZZ%05d", next)
				if !taken[licence] {
					break
				}
			}
		}
		if !newInRace(e) || (race != "" && e.RaceID != race) {
			continue
		}
		name := mdsField(e.Name)
		switch {
		case e.Cap == "" || utf8.RuneCountInString(e.Cap) > mdsCapWidth:
			return nil, 0, fmt.Errorf("%w: start number %q does not fit %d characters", ErrInvalid, e.Cap, mdsCapWidth)
		case len(e.T1) > mdsTransWidth || len(e.T2) > mdsTransWidth:
			return nil, 0, fmt.Errorf("%w: transponder of %s does not fit %d characters", ErrInvalid, e.Cap, mdsTransWidth)
		case len(licence) > mdsLicenceWidth:
			return nil, 0, fmt.Errorf("%w: licence number of %s does not fit %d characters", ErrInvalid, e.Cap, mdsLicenceWidth)
		case e.Licence == "" && name == "":
			return nil, 0, fmt.Errorf("%w: racer %s has no name", ErrInvalid, e.Cap)
		}
		if r := []rune(name); len(r) > mdsNameWidth {
			name = string(r[:mdsNameWidth])
		}
		out.WriteString(strings.Join([]string{
			quoted(e.Cap), quoted(licence), quoted(""), quoted(e.T1), quoted(e.T2), quoted(name),
		}, ";") + "\r\n")
		written++
	}
	return []byte(out.String()), written, nil
}

// mdsField makes a value safe inside a quoted field: ASCII, without the quote character that would end the field.
func mdsField(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(mdsASCII.Replace(s), `"`, "'"))
}

func quoted(s string) string { return `"` + mdsField(s) + `"` }
