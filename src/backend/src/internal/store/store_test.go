package store

import (
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/vuurcode/live-results-experiment/backend/internal/results"
)

// snapshot is a distance with two competitors; the first has the given number of laps when withTime is set.
func snapshot(laps int, withTime bool) *results.Processed {
	first := results.Competitor{ID: "1", Name: "C1", DistanceID: "d1", Heat: 1, Lane: "white"}
	if withTime {
		first.LapsCount = laps
		first.TotalTime = "00:00:10.000"
	}
	return &results.Processed{Name: "E", Distances: []results.Distance{{
		Meta:        results.DistanceMeta{ID: "d1", Name: "1000 meter"},
		Competitors: []results.Competitor{first, {ID: "2", Name: "C2", DistanceID: "d1", Heat: 1, Lane: "white"}},
	}}}
}

// repeat updates the store with the same reply n times and returns the last result.
func repeat(s *Store, curr *results.Processed, n int) Result {
	var res Result
	for range n {
		res = s.Update(curr)
	}
	return res
}

func types(msgs [][]byte) string {
	var out []string
	for _, m := range msgs {
		var v struct{ Type string }
		_ = json.Unmarshal(m, &v)
		out = append(out, v.Type)
	}
	return strings.Join(out, ",")
}

func TestSettingNoTimeStatusDoesNotResetTheCache(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(2, true))
	curr := snapshot(0, false)
	remark := "DQ"
	curr.Distances[0].Competitors[0].Remark = &remark
	res := s.Update(curr)
	if res.Reset {
		t.Error("a race that stops showing its times is not a reset")
	}
	if len(res.CompUpdates) != 1 || res.CompUpdates[0].LapsCount != 0 {
		t.Errorf("expected one update without laps, got %+v", res.CompUpdates)
	}
}

func TestStoreDiff(t *testing.T) {
	s := New(slog.Default())

	res := s.Update(snapshot(0, false))
	if got := types(res.Messages); got != "event_name,distance_meta,competitor_update,competitor_update" {
		t.Fatalf("first update = %s (start list must be sent even without times)", got)
	}
	if res := s.Update(snapshot(0, false)); len(res.Messages) != 0 {
		t.Errorf("unchanged data produced %s", types(res.Messages))
	}

	res = s.Update(snapshot(3, true))
	if got := types(res.Messages); got != "competitor_update" {
		t.Errorf("lap update = %s, want one competitor_update", got)
	}

	// Replay carries every competitor, with their latest state.
	replay := s.Replay()
	if got := types(replay); got != "event_name,distance_meta,competitor_update,competitor_update" {
		t.Errorf("replay = %s", got)
	}
	if !strings.Contains(string(replay[2]), `"laps_count":3`) {
		t.Errorf("replay is stale: %s", replay[2])
	}

	// Laps going backwards means the source restarted, once that has been the answer long enough.
	res = repeat(s, snapshot(0, false), HoldReplies)
	if !res.Reset || types(res.Messages) != "reset,event_name,distance_meta,competitor_update,competitor_update" {
		t.Errorf("reset update = %v %s", res.Reset, types(res.Messages))
	}
}

func TestSuppressNoTimeUpdates(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(0, false))
	changed := snapshot(0, false)
	changed.Distances[0].Competitors[0].Heat = 9 // changes, but still has no time
	if res := s.Update(changed); len(res.CompUpdates) != 0 {
		t.Errorf("no-time change was broadcast")
	}
	if got := len(s.Replay()); got != 4 {
		t.Errorf("suppressed competitor dropped from replay: %d messages", got)
	}
}

func TestRaceRemovedFromItsDistanceResetsTheCache(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(0, false))
	curr := snapshot(0, false)
	curr.Distances[0].Competitors = curr.Distances[0].Competitors[:1]
	res := repeat(s, curr, HoldReplies)
	if !res.Reset || !strings.HasPrefix(types(res.Messages), "reset,") {
		t.Fatalf("messages %q (reset %v), want a reset first", types(res.Messages), res.Reset)
	}
	if got := len(s.Replay()); got != 3 { // event name, distance, the one race left
		t.Errorf("replay holds %d messages, want 3", got)
	}
}

func TestMissingDistanceIsNotAChangedDraw(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(0, false))
	res := s.Update(&results.Processed{Name: "E"})
	if res.Reset {
		t.Error("an answer without the distance is not a change of its races")
	}
}

// The data source now and then answers with an older version of the results. Replaying such a sequence must neither
// reset the cache nor send anything for the stale replies, however often they come back.
func TestReplayOfAFlickeringSourceNeverResets(t *testing.T) {
	// laps of the first competitor per reply; a lower number is a stale reply between fresh ones
	laps := []int{3, 4, 3, 4, 5, 4, 5, 5, 3, 3, 6, 7, 6, 7, 8}
	s := New(slog.Default())
	sent := 0
	for i, n := range laps {
		res := s.Update(snapshot(n, true))
		if res.Reset {
			t.Fatalf("reply %d (%d laps) reset the cache", i, n)
		}
		for _, c := range res.CompUpdates {
			if c.ID != "1" {
				continue
			}
			if c.LapsCount < sent {
				t.Fatalf("reply %d sent %d laps after %d", i, c.LapsCount, sent)
			}
			sent = c.LapsCount
		}
	}
	if sent != 8 {
		t.Errorf("last laps sent %d, want 8", sent)
	}
}

func TestRacesVanishingForAMomentDoNotReset(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(1, true))
	empty := snapshot(1, true)
	empty.Distances[0].Competitors = nil // the distance is there, its races are not
	for i, curr := range []*results.Processed{empty, snapshot(1, true), empty, empty, snapshot(2, true)} {
		if res := s.Update(curr); res.Reset {
			t.Fatalf("reply %d reset the cache", i)
		}
	}
	if got := len(s.Replay()); got != 4 {
		t.Errorf("replay holds %d messages, want 4", got)
	}
}

func TestLapsThatStayDownAreAccepted(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(26, true))
	for i := 1; i < HoldReplies; i++ {
		if res := s.Update(snapshot(25, true)); !res.Held || len(res.Messages) != 0 {
			t.Fatalf("reply %d should be held, got %+v", i, res)
		}
	}
	if res := s.Update(snapshot(25, true)); !res.Reset {
		t.Error("laps that stay down for good are a reset in the end")
	}
	if !strings.Contains(string(s.Replay()[2]), `"laps_count":25`) {
		t.Errorf("replay still holds the old laps: %s", s.Replay()[2])
	}
}

func TestExtraLapTakenBackAtTheFinishIsNoReset(t *testing.T) {
	meters := 1000
	with := func(laps int) *results.Processed {
		p := snapshot(laps, true)
		p.Distances[0].Meta.DistanceMeters = &meters
		return p
	}
	s := New(slog.Default())
	s.Update(with(5))
	if res := s.Update(with(4)); !res.Held {
		t.Errorf("4 laps of 1000 m is no finish, got %+v", res)
	}
	s.Update(with(4))
	res := s.Update(with(3))
	if res.Held || res.Reset || !strings.Contains(types(res.Messages), "competitor_update") {
		t.Errorf("3 laps of 1000 m is a correction, got %+v", res)
	}
	if res := s.Update(with(1)); !res.Held {
		t.Errorf("a drop below the laps needed is held, got %+v", res)
	}
}

func TestFewerLapsWithARemarkIsNoReset(t *testing.T) {
	s := New(slog.Default())
	s.Update(snapshot(4, true))
	curr := snapshot(2, true)
	remark := "DNF"
	curr.Distances[0].Competitors[0].Remark = &remark
	if res := s.Update(curr); res.Held || res.Reset {
		t.Errorf("a race marked DNF explains its laps, got %+v", res)
	}
}
