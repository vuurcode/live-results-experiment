package main

import (
	"encoding/json"
	"testing"
)

func TestRecordedSampleHasTheWholeStartList(t *testing.T) {
	samples := map[int]string{
		0: `{"success":true,"distances":[{"id":"d1","eventNumber":1,"isLive":true,"races":[{"id":"r1","heat":1,"status":0}]}]}`,
		1: `{"success":true,"distances":[{"id":"d1","eventNumber":1,"isLive":true,"races":[{"id":"r1","heat":1,"status":4,"time":"00:00:40","rank":1,"laps":[{}]},{"id":"r2","heat":2,"status":0}]},{"id":"d2","eventNumber":2,"isLive":false,"races":[{"id":"r3","heat":1,"status":0}]}]}`,
		2: `{"success":false,"distances":[]}`,
	}
	list := newStartList(len(samples), func(i int) []byte { return []byte(samples[i]) })

	var doc struct {
		Distances []struct {
			ID    string `json:"id"`
			Races []struct {
				ID     string `json:"id"`
				Status int    `json:"status"`
			} `json:"races"`
		} `json:"distances"`
	}
	if err := json.Unmarshal(list.complete(0, []byte(samples[0])), &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Distances) != 2 || len(doc.Distances[0].Races) != 2 || len(doc.Distances[1].Races) != 1 {
		t.Fatalf("first sample: %+v, want both distances and all three races", doc)
	}
	if got := doc.Distances[0].Races[1]; got.ID != "r2" || got.Status != 0 {
		t.Errorf("added race: %+v, want r2 not started", got)
	}
	if string(list.complete(2, []byte(samples[2]))) != samples[2] {
		t.Error("the not-live sample was changed")
	}
	if err := json.Unmarshal(list.complete(1, []byte(samples[1])), &doc); err != nil || doc.Distances[0].Races[0].Status != 4 {
		t.Errorf("a race the sample has was altered: %+v %v", doc, err)
	}
}
