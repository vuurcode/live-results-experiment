// Package dts holds the data model of a DTS race-day export and the rules that apply sign-in operations to it.
package dts

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

// Race is a DTS_Wedstrijd. Start is the local event time as written in the file, which carries no time zone.
type Race struct {
	ID       string
	Code     string
	Name     string
	Place    string
	Category string
	Start    time.Time
}

// Title names the race for people: "<place> - <name> - <HH.mm> uur - <category>". An empty place, name or category is left out, and the category code stands in when all three are.
func (r Race) Title() string {
	parts := []string{}
	if r.Place != "" {
		parts = append(parts, r.Place)
	}
	if r.Name != "" {
		parts = append(parts, r.Name)
	}
	parts = append(parts, r.Start.Format("15.04")+" uur")
	if r.Category != "" {
		parts = append(parts, r.Category)
	}
	if len(parts) == 1 {
		parts = append(parts, r.Code)
	}
	return strings.Join(parts, " - ")
}

// Rider is a DTS_Licentiehouder.
type Rider struct {
	Licence string
	Name    string
	Town    string
	Sponsor string
	Class   string
	ValidTo string
	// Melding is the notice MDS keeps for the licence holder, and Jury whether it asks to register at the jury.
	Melding string
	Jury    bool
}

// Entry is one rider in one race (a DTS_Deelname). ID stays the same when the entry moves to another race.
type Entry struct {
	ID      string
	Licence string
	// NewLicence is the number typed for an added racer that is not in the file.
	NewLicence string
	RaceID     string
	Cap        string
	T1         string
	T2         string
	Signed     bool
	SignedAt   time.Time // when the entry was signed; zero for entries signed in the file
	SignedBy   string    // the device that signed it; empty for entries signed in the file
	// Added is set for a racer that was added during the day; Name is then the name as typed.
	Added bool
	Name  string
	// Melding and Jury are a notice that came with the entry in the file.
	Melding string
	Jury    bool
}

// Doc is a parsed export: the read-only races and riders, and the entries the operations change.
type Doc struct {
	Races  []Race
	Riders map[string]Rider
	// Notices are the separate DTS_Melding records, by licence.
	Notices map[string][]Notice
	Entries []Entry
}

var (
	capPattern         = regexp.MustCompile(`^[A-Z]?[0-9]{1,3}$`)
	transponderPattern = regexp.MustCompile(`^[A-Z]{2}-[0-9]{5}$`)
)

// ErrInvalid is wrapped by every error about a value or an operation that is not acceptable.
var ErrInvalid = errors.New("invalid")

// ValidCap reports whether s is a leg number: an optional capital letter and one to three digits.
func ValidCap(s string) bool { return capPattern.MatchString(s) }

// ValidTransponder reports whether s is a transponder code such as AB-12345.
func ValidTransponder(s string) bool { return transponderPattern.MatchString(s) }
