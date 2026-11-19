package dts

import (
	"cmp"
	"slices"
)

// Warning levels. A warning never blocks an operation.
const (
	Severe = "severe"
	Light  = "light"
)

// Warning kinds.
const (
	DuplicateCap         = "cap"
	DuplicateTransponder = "transponder"
)

// Warning says that two or more entries share a value they should not. Race is set for a severe warning, which is always
// within one race; a light warning spans races and has no race.
type Warning struct {
	Level   string   `json:"level"`
	Kind    string   `json:"kind"`
	Value   string   `json:"value"`
	Race    string   `json:"race,omitempty"`
	Entries []string `json:"entries"`
}

// Warnings checks the entries for collisions:
//   - severe: the same cap number twice in one race, or the same transponder (either slot) on two entries in one race
//   - light: the same transponder on entries of different riders (by licence number) in different races
//
// The same cap number in different races, and the same rider in several races (also with the same transponder), are never a warning.
func Warnings(entries []Entry) []Warning {
	var out []Warning

	type raceValue struct{ race, value string }
	caps := map[raceValue][]string{}
	byTransponder := map[string][]Entry{}
	for _, e := range entries {
		if e.Cap != "" {
			k := raceValue{e.RaceID, e.Cap}
			caps[k] = append(caps[k], e.ID)
		}
		for _, t := range uniqueNonEmpty(e.T1, e.T2) {
			byTransponder[t] = append(byTransponder[t], e)
		}
	}
	for k, ids := range caps {
		if len(ids) > 1 {
			out = append(out, Warning{Level: Severe, Kind: DuplicateCap, Value: k.value, Race: k.race, Entries: sorted(ids)})
		}
	}
	for t, es := range byTransponder {
		perRace := map[string][]string{}
		for _, e := range es {
			perRace[e.RaceID] = append(perRace[e.RaceID], e.ID)
		}
		for race, ids := range perRace {
			if len(ids) > 1 {
				out = append(out, Warning{Level: Severe, Kind: DuplicateTransponder, Value: t, Race: race, Entries: sorted(ids)})
			}
		}
		riders := map[string]bool{}
		for _, e := range es {
			riders[riderKey(e)] = true
		}
		if len(perRace) > 1 && len(riders) > 1 {
			ids := make([]string, 0, len(es))
			for _, e := range es {
				ids = append(ids, e.ID)
			}
			out = append(out, Warning{Level: Light, Kind: DuplicateTransponder, Value: t, Entries: sorted(ids)})
		}
	}
	slices.SortFunc(out, func(a, b Warning) int {
		return cmp.Or(cmp.Compare(a.Level, b.Level)*-1, cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.Value, b.Value), cmp.Compare(a.Race, b.Race))
	})
	return out
}

// riderKey is the licence number, so one rider in several races counts once; an entry without one counts as its own rider.
func riderKey(e Entry) string {
	if e.Licence != "" {
		return "licence:" + e.Licence
	}
	return "entry:" + e.ID
}

func uniqueNonEmpty(vals ...string) []string {
	var out []string
	for _, v := range vals {
		if v != "" && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

func sorted(s []string) []string {
	s = slices.Clone(s)
	slices.Sort(s)
	return s
}
