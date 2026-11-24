// Package api serves the DTS sessions over HTTP.
package api

import (
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/vuurcode/live-results-experiment/dts/internal/dts"
	"github.com/vuurcode/live-results-experiment/dts/internal/store"
)

// EntryView is an entry as the pages show it.
type EntryView struct {
	ID      string `json:"id"`
	Licence string `json:"licence,omitempty"`
	// NewLicence is the number typed for an added racer; the page counts up from the highest one.
	NewLicence string    `json:"newLicence,omitempty"`
	Name       string    `json:"name"`
	Cap        string    `json:"cap"`
	T1         string    `json:"t1,omitempty"`
	T2         string    `json:"t2,omitempty"`
	Signed     bool      `json:"signed"`
	SignedAt   time.Time `json:"signedAt,omitzero"`
	// SignedBy is the name of the device that signed the entry, or its id when it has no name.
	SignedBy string `json:"signedBy,omitempty"`
	// MinutesLate is how long after the cutoff the entry was signed, rounded up; 0 when it was not late.
	MinutesLate int  `json:"minutesLate,omitempty"`
	Added       bool `json:"added,omitempty"`
	// Changed is set when the number, a transponder or the race differs from the uploaded file, or the racer was added.
	Changed bool `json:"changed,omitempty"`
	// Orig holds the cap number and transponders of the uploaded file, for an entry that is in the file and was changed.
	Orig *OrigView `json:"orig,omitempty"`
}

// OrigView is what the uploaded file says of an entry.
type OrigView struct {
	Cap string `json:"cap"`
	T1  string `json:"t1,omitempty"`
	T2  string `json:"t2,omitempty"`
}

// RaceView is a race with its entries and counts.
type RaceView struct {
	ID            string      `json:"id"`
	Code          string      `json:"code"`
	Name          string      `json:"name"`
	Title         string      `json:"title"`
	Category      string      `json:"category,omitempty"`
	Closed        bool        `json:"closed,omitempty"`
	Start         string      `json:"start"` // local event time, no zone
	CutoffMinutes int         `json:"cutoffMinutes"`
	CutoffAt      time.Time   `json:"cutoffAt"`
	CutoffCustom  bool        `json:"cutoffCustom,omitempty"`
	Signed        int         `json:"signed"`
	Unsigned      int         `json:"unsigned"`
	Late          int         `json:"late"`
	Entries       []EntryView `json:"entries"`
}

// Note is a note as replayed from its events.
type Note struct {
	ID         string    `json:"id"`
	Entry      string    `json:"entry"`
	Level      string    `json:"level"`
	Text       string    `json:"text"`
	By         string    `json:"by"`
	At         time.Time `json:"at"`
	Resolved   bool      `json:"resolved"`
	ResolvedBy string    `json:"resolvedBy,omitempty"`
	ResolvedAt time.Time `json:"resolvedAt,omitzero"`
}

// DeviceView is a device that uses the sign link.
type DeviceView struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	LastSeen time.Time `json:"lastSeen"`
	// Signs counts the signatures the device made, Changes its other operations.
	Signs    int   `json:"signs"`
	Changes  int   `json:"changes"`
	OffsetMs int64 `json:"offsetMs"`
	// ClockOff is set when the device's clock is more than five seconds from the server's.
	ClockOff bool `json:"clockOff,omitempty"`
}

// State is what both pages read.
type State struct {
	ID       string         `json:"id"`
	Now      time.Time      `json:"now"`
	Changed  time.Time      `json:"changed,omitzero"` // client time of the newest operation
	Synced   time.Time      `json:"synced,omitzero"`  // when the sign page last sent something
	Races    []RaceView     `json:"races"`
	Warnings []dts.Warning  `json:"warnings"`
	Rejected []dts.Rejected `json:"rejected"`
	Notes    []Note         `json:"notes"`
	Actions  []store.Action `json:"latestActions"`
	Totals   map[string]int `json:"totals"`
	Devices  []DeviceView   `json:"devices"`
}

const latestActions = 20

// BuildState replays the session's operations over its XML. loc is the zone of the race start times.
func BuildState(sess *store.Session, defaultCutoff func(store.Meta, string) int, loc *time.Location, now time.Time) (*State, []dts.Entry, *dts.Doc, error) {
	doc, err := dts.Parse(sess.Source)
	if err != nil {
		return nil, nil, nil, err
	}
	entries, rejected := doc.Replay(sess.Ops)
	st := &State{
		ID: sess.ID, Now: now.UTC(), Changed: sess.Meta.Changed, Synced: sess.Meta.Synced,
		Warnings: dts.Warnings(entries), Rejected: rejected, Notes: replayNotes(doc.ImportedNotes(), capNotes(doc, entries, sess.Ops), sess.Notes),
		Totals: map[string]int{},
	}
	names := map[string]string{}
	signs, changes := map[string]int{}, map[string]int{}
	for _, op := range sess.Ops {
		if op.Kind == dts.OpSign {
			signs[op.Device]++
		} else {
			changes[op.Device]++
		}
	}
	st.Devices = []DeviceView{}
	for id, d := range sess.Meta.Devices {
		name := d.Name
		if name == "" {
			name = id
		}
		names[id] = name
		st.Devices = append(st.Devices, DeviceView{ID: id, Name: name, LastSeen: d.LastSeen, Signs: signs[id], Changes: changes[id], OffsetMs: d.OffsetMs, ClockOff: d.OffsetMs > 5000 || d.OffsetMs < -5000})
	}
	slices.SortFunc(st.Devices, func(a, b DeviceView) int { return strings.Compare(a.Name+a.ID, b.Name+b.ID) })
	if st.Warnings == nil {
		st.Warnings = []dts.Warning{}
	}
	if st.Rejected == nil {
		st.Rejected = []dts.Rejected{}
	}
	original := map[string]dts.Entry{}
	for _, e := range doc.Entries {
		original[e.ID] = e
	}
	for _, race := range doc.Races {
		start := time.Date(race.Start.Year(), race.Start.Month(), race.Start.Day(), race.Start.Hour(), race.Start.Minute(), race.Start.Second(), 0, loc)
		minutes := defaultCutoff(sess.Meta, race.ID)
		_, custom := sess.Meta.Cutoffs[race.ID]
		rv := RaceView{
			ID: race.ID, Code: race.Code, Name: race.Name, Title: race.Title(), Category: race.Category, Closed: sess.Meta.Closed[race.ID], Start: race.Start.Format("2006-01-02T15:04:05"),
			CutoffMinutes: minutes, CutoffAt: start.Add(-time.Duration(minutes) * time.Minute).UTC(), CutoffCustom: custom,
			Entries: []EntryView{},
		}
		for _, e := range entries {
			if e.RaceID != race.ID {
				continue
			}
			v := EntryView{ID: e.ID, Licence: e.Licence, NewLicence: e.NewLicence, Name: nameOf(doc, e), Cap: e.Cap, T1: e.T1, T2: e.T2, Signed: e.Signed, SignedAt: e.SignedAt, Added: e.Added}
			if o, ok := original[e.ID]; !ok || o.Cap != e.Cap || o.T1 != e.T1 || o.T2 != e.T2 || o.RaceID != e.RaceID {
				v.Changed = true
				if ok {
					v.Orig = &OrigView{Cap: o.Cap, T1: o.T1, T2: o.T2}
				}
			}
			if e.SignedBy != "" {
				v.SignedBy = cmpName(names, e.SignedBy)
			}
			if e.Signed {
				rv.Signed++
				if !e.SignedAt.IsZero() && e.SignedAt.After(rv.CutoffAt) {
					v.MinutesLate = int(math.Ceil(e.SignedAt.Sub(rv.CutoffAt).Minutes()))
					rv.Late++
				}
			} else {
				rv.Unsigned++
			}
			rv.Entries = append(rv.Entries, v)
		}
		slices.SortStableFunc(rv.Entries, func(a, b EntryView) int { return strings.Compare(a.Cap, b.Cap) })
		st.Totals["signed"] += rv.Signed
		st.Totals["unsigned"] += rv.Unsigned
		st.Races = append(st.Races, rv)
	}
	from := max(0, len(sess.Actions)-latestActions)
	st.Actions = slices.Clone(sess.Actions[from:])
	slices.Reverse(st.Actions)
	if st.Actions == nil {
		st.Actions = []store.Action{}
	}
	return st, entries, doc, nil
}

func nameOf(doc *dts.Doc, e dts.Entry) string {
	if r, ok := doc.Riders[e.Licence]; ok {
		return r.Name
	}
	return e.Name
}

// capNotes logs a changed start number of an entry of the file as a note, and a racer added without any transponder. MDS has no field for it in the sign list, so the
// entry stays signed under its old number and the note tells the jury and the office about the new one.
func capNotes(doc *dts.Doc, entries []dts.Entry, ops []dts.Op) []Note {
	original := map[string]dts.Entry{}
	for _, e := range doc.Entries {
		original[e.ID] = e
	}
	at := map[string]time.Time{}
	for _, op := range ops {
		if op.Kind == dts.OpCap && op.At.After(at[op.Entry]) {
			at[op.Entry] = op.At
		}
	}
	added := map[string]time.Time{}
	for _, op := range ops {
		if op.Kind == dts.OpAddRacer {
			added[op.ID] = op.At
		}
	}
	out := []Note{}
	for _, e := range entries {
		if e.Added && e.T1 == "" && e.T2 == "" {
			out = append(out, Note{ID: "notp:" + e.ID, Entry: e.ID, Level: store.LevelNote, By: "DTS", At: added[e.ID],
				Text: "Zonder transponder toegevoegd; vul de transponder aan zodra bekend"})
		}
		if o, ok := original[e.ID]; ok && !e.Added && o.Cap != e.Cap {
			out = append(out, Note{ID: "cap:" + e.ID, Entry: e.ID, Level: store.LevelNote, By: "DTS", At: at[e.ID],
				Text: fmt.Sprintf("Beennummer gewijzigd van %s naar %s; getekend onder het oude nummer %s", o.Cap, e.Cap, o.Cap)})
		}
	}
	return out
}

// replayNotes is the notes of the file followed by those added during the day, with the resolutions applied to both.
func replayNotes(imported []dts.ImportedNote, derived []Note, events []store.NoteEvent) []Note {
	notes := []Note{}
	idx := map[string]int{}
	for _, n := range imported {
		level := store.LevelNote
		if n.Warning {
			level = store.LevelWarning
		}
		idx[n.ID] = len(notes)
		notes = append(notes, Note{ID: n.ID, Entry: n.Entry, Level: level, Text: n.Text, By: "MDS", At: n.At})
	}
	for _, n := range derived {
		idx[n.ID] = len(notes)
		notes = append(notes, n)
	}
	for _, ev := range events {
		switch ev.Kind {
		case "add":
			idx[ev.ID] = len(notes)
			notes = append(notes, Note{ID: ev.ID, Entry: ev.Entry, Level: ev.Level, Text: ev.Text, By: ev.By, At: ev.At})
		case "resolve":
			if i, ok := idx[ev.NoteID]; ok && !notes[i].Resolved {
				notes[i].Resolved, notes[i].ResolvedBy, notes[i].ResolvedAt = true, ev.By, ev.At
			}
		}
	}
	return notes
}

// exportName names an export file after the date of the first race and, for one race, its title.
func exportName(doc *dts.Doc, raceID string) string {
	date := doc.Races[0].Start.Format("2006-01-02")
	if raceID == "" {
		return fmt.Sprintf("DTS_%s_updated.xml", date)
	}
	race, _ := doc.Race(raceID)
	code := strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '.' || r == ' ' {
			return r
		}
		return '_'
	}, race.Title())
	return fmt.Sprintf("DTS_%s_%s_updated.xml", date, code)
}

// mdsNewName names the file of the new riders. MDS imports a text file as an Access object named after the file, and
// Access cuts an object name at 64 characters and takes a dot or a space in it badly: the name is short and plain
// (letters, digits and underscores), with the date and the category code of the race.
func mdsNewName(doc *dts.Doc, raceID string) string {
	date := doc.Races[0].Start.Format("20060102")
	if race, ok := doc.Race(raceID); ok {
		code := strings.Map(func(r rune) rune {
			if r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, race.Code)
		if code != "" {
			return fmt.Sprintf("DTS_%s_%s_nieuw.txt", date, code)
		}
	}
	return fmt.Sprintf("DTS_%s_nieuw.txt", date)
}

func cmpName(names map[string]string, id string) string {
	if n, ok := names[id]; ok {
		return n
	}
	return id
}
