package main

import (
	"encoding/json"
	"fmt"
	"maps"
)

// The live feed of a match that is yet to start lists its whole start list, every heat of every distance, and a
// recording made once the match was running grows with the heats the timing published. A replay of a recording
// serves the heats it has not reached yet as they stand at the start: not started, no times and no rank.

type startListEntry struct {
	distance map[string]any // the distance as first seen, without its races
	race     map[string]any // the race as first seen, blanked
	seenAt   int            // the index of the first sample that has the race
}

// startList is the races of a recording, in the order they were first seen, by distance id.
type startList struct {
	distances []string
	entries   map[string][]startListEntry
}

// blankRace is a race as it stands before it starts.
func blankRace(race map[string]any) map[string]any {
	blank := maps.Clone(race)
	blank["status"] = float64(0)
	blank["time"] = "00:00:00"
	blank["laps"] = nil
	blank["rank"] = nil
	blank["points"] = nil
	blank["remark"] = ""
	blank["invalidReason"] = ""
	return blank
}

// parseDistances returns the distances of a sample, or nil when it holds none (the not-live error).
func parseDistances(data []byte) (map[string]any, []any) {
	var doc map[string]any
	if json.Unmarshal(data, &doc) != nil {
		return nil, nil
	}
	distances, _ := doc["distances"].([]any)
	return doc, distances
}

// newStartList collects the races of the samples, loaded one by one so that only the start list stays in memory.
func newStartList(count int, load func(i int) []byte) *startList {
	sl := &startList{entries: map[string][]startListEntry{}}
	seen := map[string]bool{}
	for i := range count {
		_, distances := parseDistances(load(i))
		for _, d := range distances {
			distance, _ := d.(map[string]any)
			id, _ := distance["id"].(string)
			races, _ := distance["races"].([]any)
			if _, ok := sl.entries[id]; !ok {
				sl.distances = append(sl.distances, id)
				sl.entries[id] = nil
			}
			for _, r := range races {
				race, _ := r.(map[string]any)
				raceID := fmt.Sprint(id, "/", race["id"])
				if seen[raceID] {
					continue
				}
				seen[raceID] = true
				head := maps.Clone(distance)
				delete(head, "races")
				sl.entries[id] = append(sl.entries[id], startListEntry{distance: head, race: blankRace(race), seenAt: i})
			}
		}
	}
	return sl
}

// complete adds to sample i the distances and races that only later samples have, so its start list is whole.
// A sample without distances (the not-live error) is returned as it is.
func (sl *startList) complete(i int, data []byte) []byte {
	doc, distances := parseDistances(data)
	if len(distances) == 0 {
		return data
	}
	index := map[string]map[string]any{}
	has := map[string]bool{}
	for _, d := range distances {
		distance, _ := d.(map[string]any)
		id, _ := distance["id"].(string)
		index[id] = distance
		races, _ := distance["races"].([]any)
		for _, r := range races {
			race, _ := r.(map[string]any)
			has[fmt.Sprint(id, "/", race["id"])] = true
		}
	}
	for _, id := range sl.distances {
		for _, e := range sl.entries[id] {
			if e.seenAt <= i || has[fmt.Sprint(id, "/", e.race["id"])] {
				continue
			}
			distance, ok := index[id]
			if !ok {
				distance = maps.Clone(e.distance)
				distance["isLive"] = false
				distances = append(distances, distance)
				index[id] = distance
			}
			races, _ := distance["races"].([]any)
			distance["races"] = append(races, maps.Clone(e.race))
		}
	}
	doc["distances"] = distances
	out, err := json.Marshal(doc)
	if err != nil {
		return data
	}
	return out
}
