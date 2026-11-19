package dts

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Operation kinds. Each changes one field of one entry; AddRacer creates an entry.
const (
	OpSign      = "sign"
	OpCap       = "cap"
	OpT1        = "transponder1"
	OpT2        = "transponder2"
	OpRace      = "race"
	OpAddRacer  = "add-racer"
	maxNameSize = 45
	maxField    = 256
)

// Op is one change made on the sign page. ID is made by the client and makes a resend harmless; At is the client's clock.
type Op struct {
	ID    string    `json:"id"`
	At    time.Time `json:"at"`
	Kind  string    `json:"kind"`
	Entry string    `json:"entry,omitempty"` // entry id, for every kind but add-racer
	Value string    `json:"value,omitempty"` // "1" or "0" for sign; the new cap, transponder or race id otherwise

	// Device is the id of the device that made the operation. At is its time corrected to the server's clock, DeviceAt the raw one.
	Device   string    `json:"device,omitempty"`
	DeviceAt time.Time `json:"deviceAt,omitzero"`

	// Fields of add-racer. Who is a name or a licence number, as typed.
	Who string `json:"who,omitempty"`
	// Licence is the number given to a racer that is not in the file, for the MDS import; empty for a generated one.
	Licence string `json:"licence,omitempty"`
	Race    string `json:"race,omitempty"`
	Cap     string `json:"cap,omitempty"`
	T1      string `json:"t1,omitempty"`
	T2      string `json:"t2,omitempty"`
	Signed  bool   `json:"signed,omitempty"`
}

// Rejected is an operation that could not be applied to the state, with the reason. It changes nothing.
type Rejected struct {
	Op     Op     `json:"op"`
	Reason string `json:"reason"`
}

// Validate checks the shape of an operation, before it is stored. It does not look at the state.
func (o Op) Validate() error {
	bad := func(format string, a ...any) error {
		return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, a...)...)
	}
	if o.ID == "" || len(o.ID) > 64 {
		return bad("operation id")
	}
	if o.At.IsZero() {
		return bad("operation time")
	}
	if len(o.Device) > 64 {
		return bad("device id")
	}
	if len(o.Entry) > maxField || len(o.Value) > maxField || len(o.Race) > maxField || len(o.Cap) > maxField || len(o.T1) > maxField || len(o.T2) > maxField || len(o.Who) > 4*maxNameSize {
		return bad("field too long")
	}
	switch o.Kind {
	case OpSign:
		if o.Entry == "" || (o.Value != "1" && o.Value != "0") {
			return bad("sign needs an entry and 1 or 0")
		}
	case OpCap:
		if o.Entry == "" || !ValidCap(o.Value) {
			return bad("cap number %q", o.Value)
		}
	case OpT1, OpT2:
		if o.Entry == "" || (o.Value != "" && !ValidTransponder(o.Value)) {
			return bad("transponder %q", o.Value)
		}
	case OpRace:
		if o.Entry == "" || o.Value == "" {
			return bad("race needs an entry and a race id")
		}
	case OpAddRacer:
		who := strings.TrimSpace(o.Who)
		if who == "" || utf8.RuneCountInString(who) > maxNameSize || o.Race == "" || !ValidCap(o.Cap) || !validNewLicence(o.Licence) || !ValidTransponder(o.T1) || (o.T2 != "" && !ValidTransponder(o.T2)) {
			return bad("add-racer fields")
		}
	default:
		return bad("operation kind %q", o.Kind)
	}
	return nil
}

// Replay applies the operations to a copy of the document's entries, in order of time and then id, skipping repeated ids.
// The result depends only on the set of operations, not on the order they are passed in.
func (d *Doc) Replay(ops []Op) (entries []Entry, rejected []Rejected) {
	entries = slices.Clone(d.Entries)
	sorted := slices.Clone(ops)
	slices.SortStableFunc(sorted, func(a, b Op) int {
		if c := a.At.Compare(b.At); c != 0 {
			return c
		}
		return strings.Compare(a.ID, b.ID)
	})
	seen := map[string]bool{}
	for _, op := range sorted {
		if seen[op.ID] {
			continue
		}
		seen[op.ID] = true
		var err error
		entries, err = d.apply(entries, op)
		if err != nil {
			rejected = append(rejected, Rejected{Op: op, Reason: err.Error()})
		}
	}
	return entries, rejected
}

func (d *Doc) apply(entries []Entry, op Op) ([]Entry, error) {
	if err := op.Validate(); err != nil {
		return entries, err
	}
	if op.Kind == OpAddRacer {
		if _, ok := d.Race(op.Race); !ok {
			return entries, fmt.Errorf("unknown race %q", op.Race)
		}
		// an entry id names one entry: a racer added under the id of another would be reached by that id's later operations
		if slices.ContainsFunc(entries, func(e Entry) bool { return e.ID == op.ID }) {
			return entries, fmt.Errorf("entry id %q is already in use", op.ID)
		}
		e := Entry{ID: op.ID, RaceID: op.Race, Cap: op.Cap, T1: op.T1, T2: op.T2, Signed: op.Signed, Added: true}
		if rider, ok := d.Riders[strings.TrimSpace(op.Who)]; ok {
			e.Licence, e.Name, e.Added = rider.Licence, rider.Name, false
		} else {
			e.Name = strings.TrimSpace(op.Who)
			e.NewLicence = strings.ToUpper(strings.TrimSpace(op.Licence))
		}
		if op.Signed {
			e.SignedAt, e.SignedBy = op.At, op.Device
		}
		return append(entries, e), nil
	}
	i := slices.IndexFunc(entries, func(e Entry) bool { return e.ID == op.Entry })
	if i < 0 {
		return entries, fmt.Errorf("unknown entry %q", op.Entry)
	}
	e := &entries[i]
	switch op.Kind {
	case OpSign:
		e.Signed = op.Value == "1"
		e.SignedAt, e.SignedBy = time.Time{}, ""
		if e.Signed {
			e.SignedAt, e.SignedBy = op.At, op.Device
		}
	case OpCap:
		e.Cap = op.Value
	case OpT1:
		e.T1 = op.Value
	case OpT2:
		e.T2 = op.Value
	case OpRace:
		if _, ok := d.Race(op.Value); !ok {
			return entries, fmt.Errorf("unknown race %q", op.Value)
		}
		e.RaceID = op.Value
	}
	return entries, nil
}

// validNewLicence accepts an empty number or one of at most 8 letters and digits, the width of the licence column in MDS.
func validNewLicence(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) > 8 {
		return false
	}
	for _, r := range s {
		if r > unicode.MaxASCII || (!unicode.IsLetter(r) && !unicode.IsDigit(r)) {
			return false
		}
	}
	return true
}
