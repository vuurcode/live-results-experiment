package dts

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// ErrExport is wrapped by an export that did not pass its own check; the file is not handed out.
var ErrExport = errors.New("export check failed")

// ExportSummary says what an export holds.
type ExportSummary struct {
	Entries int
}

// defaultOrder is the order of the fields of a DTS_Deelname when the source has no row to copy it from.
var defaultOrder = []string{"Wedstrijdnummer", "WedstrijdID", "ShowNr", "Transponder1", "Transponder2", "Getekend"}

var elementName = regexp.MustCompile(`<([A-Za-z0-9_]+)>`)

// Export writes the document with the entries applied, as text: lines that no change touches are copied byte for byte.
// With race set, only that race and its entries (and the riders they need) are written. now becomes the generated stamp.
// The output is parsed again and compared with the entries before it is returned.
func (d *Doc) Export(src []byte, entries []Entry, race string, now time.Time) ([]byte, ExportSummary, error) {
	var sum ExportSummary
	if race != "" {
		if _, ok := d.Race(race); !ok {
			return nil, sum, fmt.Errorf("%w: unknown race %q", ErrInvalid, race)
		}
	}
	eol := "\n"
	if bytes.Contains(src, []byte("\r\n")) {
		eol = "\r\n"
	}
	lines := chunks(string(src))
	order := fieldOrder(lines)
	multi := slices.ContainsFunc(lines, func(c string) bool {
		return strings.HasPrefix(c, "<DTS_Deelname>") && strings.Contains(strings.TrimRight(c, "\r\n"), "\n")
	})

	byID := map[string]Entry{}
	for _, e := range entries {
		byID[e.ID] = e
	}
	wanted := wantedEntries(entries, race)
	needRider := map[string]bool{}
	for _, e := range wanted {
		if e.Licence != "" {
			needRider[e.Licence] = true
		}
	}

	var out strings.Builder
	lastEntry := -1
	for _, raw := range lines {
		body := strings.TrimRight(raw, "\r\n")
		end := raw[len(body):]
		switch {
		case strings.Contains(body, "<dataroot"):
			out.WriteString(generated.ReplaceAllString(body, `generated="`+now.Format(startLayout)+`"`) + end)
		case strings.HasPrefix(body, "<DTS_Wedstrijd>"):
			if race == "" || fieldValue(body, "WedstrijdID") == race {
				out.WriteString(raw)
			}
		case strings.HasPrefix(body, "<DTS_Licentiehouder>"):
			if race == "" || needRider[fieldValue(body, "Wedstrijdnummer")] {
				out.WriteString(raw)
			}
		case strings.HasPrefix(body, "<DTS_Deelname>"):
			id := fieldValue(body, "Wedstrijdnummer") + "@" + fieldValue(body, "WedstrijdID")
			e, ok := byID[id]
			if !ok || (race != "" && e.RaceID != race) {
				continue
			}
			out.WriteString(rewrite(body, e, order) + end)
			lastEntry = out.Len()
		default:
			out.WriteString(raw)
		}
	}

	text := out.String()
	var added strings.Builder
	for _, e := range wanted {
		if e.Added || !fileHas(d, e) {
			added.WriteString(newRow(e, order, multi, eol) + eol)
		}
	}
	if added.Len() > 0 {
		if lastEntry < 0 {
			lastEntry = strings.LastIndex(text, "</dataroot>")
			if lastEntry < 0 {
				lastEntry = len(text)
			}
		}
		text = text[:lastEntry] + added.String() + text[lastEntry:]
	}
	result := []byte(text)
	if err := d.check(result, src, entries, race); err != nil {
		return nil, sum, err
	}
	sum.Entries = len(wanted)
	return result, sum, nil
}

var generated = regexp.MustCompile(`generated="[^"]*"`)

// fileHas reports whether the entry is a row of the source file, which a new entry never is.
func fileHas(d *Doc, e Entry) bool {
	return slices.ContainsFunc(d.Entries, func(o Entry) bool { return o.ID == e.ID })
}

func wantedEntries(entries []Entry, race string) []Entry {
	var out []Entry
	for _, e := range entries {
		if race == "" || e.RaceID == race {
			out = append(out, e)
		}
	}
	return out
}

// recordTags are the records of the file. A record is written on one line or, with a line per field, over several.
var recordTags = []string{"DTS_Wedstrijd", "DTS_Licentiehouder", "DTS_Deelname"}

// chunks splits the text into lines, except that the lines of a record that spans several are kept together.
func chunks(src string) []string {
	lines := strings.SplitAfter(src, "\n")
	var out []string
	for i := 0; i < len(lines); i++ {
		tag := ""
		for _, t := range recordTags {
			if strings.HasPrefix(lines[i], "<"+t+">") {
				tag = t
			}
		}
		if tag == "" || strings.Contains(lines[i], "</"+tag+">") {
			out = append(out, lines[i])
			continue
		}
		var b strings.Builder
		for ; i < len(lines); i++ {
			b.WriteString(lines[i])
			if strings.Contains(lines[i], "</"+tag+">") {
				break
			}
		}
		out = append(out, b.String())
	}
	return out
}

// fieldOrder takes the order of the fields from the DTS_Deelname row that has the most, completed with the default order.
func fieldOrder(lines []string) []string {
	var best []string
	for _, l := range lines {
		if !strings.HasPrefix(l, "<DTS_Deelname>") {
			continue
		}
		var names []string
		for _, m := range elementName.FindAllStringSubmatch(l, -1) {
			if m[1] != "DTS_Deelname" {
				names = append(names, m[1])
			}
		}
		if len(names) > len(best) {
			best = names
		}
	}
	if best == nil {
		return slices.Clone(defaultOrder)
	}
	for i, name := range defaultOrder {
		if slices.Contains(best, name) {
			continue
		}
		at := 0
		for j := i - 1; j >= 0; j-- {
			if k := slices.Index(best, defaultOrder[j]); k >= 0 {
				at = k + 1
				break
			}
		}
		best = slices.Insert(best, at, name)
	}
	return best
}

func fieldValue(line, name string) string {
	m := regexp.MustCompile(`<` + name + `>([^<]*)</` + name + `>`).FindStringSubmatch(line)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

func element(name, value string) string {
	var esc bytes.Buffer
	_ = xml.EscapeText(&esc, []byte(value))
	return "<" + name + ">" + esc.String() + "</" + name + ">"
}

// setField sets, adds or (for an empty value) removes one field of a row, placing a new one where the order says.
func setField(line, name, value string, order []string) string {
	re := regexp.MustCompile(`(?:<` + name + `>[^<]*</` + name + `>|<` + name + `\s*/>)(?:\r?\n)?`)
	eol := ""
	if strings.Contains(line, "\n") {
		eol = "\n"
		if strings.Contains(line, "\r\n") {
			eol = "\r\n"
		}
	}
	if re.MatchString(line) {
		if value == "" {
			return re.ReplaceAllString(line, "")
		}
		return re.ReplaceAllLiteralString(line, element(name, value)+eol)
	}
	if value == "" {
		return line
	}
	at := strings.LastIndex(line, "</DTS_Deelname>")
	if at < 0 {
		return line
	}
	for _, next := range order[slices.Index(order, name)+1:] {
		if i := strings.Index(line, "<"+next+">"); i >= 0 {
			at = i
			break
		}
	}
	return line[:at] + element(name, value) + eol + line[at:]
}

// rewrite applies the entry's current values to its source row. Only the fields that differ are touched.
func rewrite(line string, e Entry, order []string) string {
	signed := "0"
	if e.Signed {
		signed = "1"
	}
	for _, f := range [][2]string{{"WedstrijdID", e.RaceID}, {"ShowNr", e.Cap}, {"Transponder1", e.T1}, {"Transponder2", e.T2}, {"Getekend", signed}} {
		if fieldValue(line, f[0]) != f[1] {
			line = setField(line, f[0], f[1], order)
		}
	}
	return line
}

func newRow(e Entry, order []string, multi bool, eol string) string {
	sep := ""
	if multi {
		sep = eol
	}
	signed := "0"
	if e.Signed {
		signed = "1"
	}
	vals := map[string]string{"Wedstrijdnummer": e.Licence, "WedstrijdID": e.RaceID, "ShowNr": e.Cap, "Transponder1": e.T1, "Transponder2": e.T2, "Getekend": signed}
	var b strings.Builder
	b.WriteString("<DTS_Deelname>" + sep)
	for _, name := range order {
		if v := vals[name]; v != "" {
			b.WriteString(element(name, v) + sep)
		}
	}
	b.WriteString("</DTS_Deelname>")
	return b.String()
}

// check parses the output and compares it with the entries it must hold. A full export must also keep every
// race and rider line of the source byte for byte.
func (d *Doc) check(out, src []byte, entries []Entry, race string) error {
	got, err := Parse(out)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrExport, err)
	}
	want := map[string]Entry{}
	for _, e := range wantedEntries(entries, race) {
		want[checkKey(e)] = e
	}
	if len(got.Entries) != len(want) {
		return fmt.Errorf("%w: %d entries written, %d expected", ErrExport, len(got.Entries), len(want))
	}
	for _, g := range got.Entries {
		w, ok := want[checkKey(g)]
		if !ok {
			return fmt.Errorf("%w: unexpected entry %s", ErrExport, g.ID)
		}
		if g.Cap != w.Cap || g.T1 != w.T1 || g.T2 != w.T2 || g.Signed != w.Signed {
			return fmt.Errorf("%w: entry %s differs from the state", ErrExport, g.ID)
		}
	}
	if race == "" && len(got.Races) != len(d.Races) {
		return fmt.Errorf("%w: races changed", ErrExport)
	}
	if race != "" && (len(got.Races) != 1 || got.Races[0].ID != race) {
		return fmt.Errorf("%w: race %s missing", ErrExport, race)
	}
	if race == "" {
		for _, kind := range []string{"<DTS_Wedstrijd>", "<DTS_Licentiehouder>"} {
			if !slices.Equal(linesWith(src, kind), linesWith(out, kind)) {
				return fmt.Errorf("%w: %s records changed", ErrExport, kind)
			}
		}
	}
	return nil
}

// checkKey identifies an entry in the comparison. A racer added by a typed name has no licence number, so the start
// number tells such entries apart.
func checkKey(e Entry) string {
	if e.Licence == "" {
		return "@" + e.RaceID + "#" + e.Cap
	}
	return e.Licence + "@" + e.RaceID
}

func linesWith(b []byte, prefix string) []string {
	var out []string
	for _, l := range chunks(string(b)) {
		if strings.HasPrefix(l, prefix) {
			out = append(out, strings.TrimRight(l, "\r\n"))
		}
	}
	return out
}
