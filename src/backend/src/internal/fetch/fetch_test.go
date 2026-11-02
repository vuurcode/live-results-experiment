package fetch

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/vuurcode/live-results-experiment/backend/internal/results"
)

type nopSink struct{}

func (nopSink) Apply(*results.Processed) bool { return false }
func (nopSink) SetFeed(string, string)        {}

type noUA struct{}

func (noUA) Get() string { return "" }

func TestOnlyLiveRepliesAreRecorded(t *testing.T) {
	bodies := []string{
		`{"success":false,"distances":[]}`,
		`{"distances":[{"id":"d","isLive":false,"races":[]}]}`,
		`{"distances":[{"id":"d","isLive":true,"races":[]}]}`,
		`{"distances":[{"id":"d","isLive":false,"races":[{"id":"final"}]}]}`, // the final results follow the last live reply
		`{"distances":[{"id":"d","isLive":false,"races":[{"id":"later"}]}]}`,
	}
	var n atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(bodies[n.Add(1)-1]))
	}))
	defer ts.Close()

	var got []string
	f := &Fetcher{URL: ts.URL, Sink: nopSink{}, UA: noUA{}, Client: ts.Client(), Log: slog.Default(), Record: func(b []byte) { got = append(got, string(b)) }}
	for range bodies {
		if err := f.once(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if len(got) != 2 || got[0] != bodies[2] || got[1] != bodies[3] {
		t.Fatalf("recorded %v", got)
	}
}

type countSink struct{ applied, feeds int }

func (c *countSink) Apply(*results.Processed) bool { c.applied++; return false }
func (c *countSink) SetFeed(string, string)        { c.feeds++ }

func TestAnUnchangedReplyIsNotProcessedAgain(t *testing.T) {
	bodies := []string{`{"distances":[]}`, `{"distances":[]}`, `{"distances":[{"id":"d","races":[]}]}`}
	var n atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(bodies[n.Add(1)-1]))
	}))
	defer ts.Close()

	sink := &countSink{}
	var recorded int
	f := &Fetcher{URL: ts.URL, Sink: sink, UA: noUA{}, Client: ts.Client(), Log: slog.Default(), Record: func([]byte) { recorded++ }}
	for range bodies {
		if err := f.once(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if sink.applied != 2 || sink.feeds != 3 {
		t.Fatalf("applied %d, feed set %d times, want 2 and 3", sink.applied, sink.feeds)
	}
}

// holdSink holds back the first n replies it is given.
type holdSink struct{ applied, hold int }

func (h *holdSink) Apply(*results.Processed) bool { h.applied++; return h.applied <= h.hold }
func (h *holdSink) SetFeed(string, string)        {}

func TestAReplyThatIsHeldBackIsLookedAtAgain(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"distances":[]}`))
	}))
	defer ts.Close()

	sink := &holdSink{hold: 2}
	f := &Fetcher{URL: ts.URL, Sink: sink, UA: noUA{}, Client: ts.Client(), Log: slog.Default()}
	for range 5 {
		if err := f.once(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	// the same reply comes in every time: it is applied until it is taken, and not again after that
	if sink.applied != 3 {
		t.Fatalf("applied %d times, want 3", sink.applied)
	}
}

func TestANotLiveReplyKeepsTheResultsOfTheCompetition(t *testing.T) {
	bodies := []string{`{"success":false,"distances":[]}`, `{"distances":[{"id":"d","races":[]}]}`, `{"success":false,"distances":[]}`}
	var n atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(bodies[n.Add(1)-1]))
	}))
	defer ts.Close()

	sink := &countSink{}
	f := &Fetcher{URL: ts.URL, Sink: sink, UA: noUA{}, Client: ts.Client(), Log: slog.Default()}
	for range bodies {
		if err := f.once(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	// the not live reply before any results is applied (it names the event); the one after the results is not
	if sink.applied != 2 || f.feed.state != "not_live" {
		t.Fatalf("applied %d, feed %q, want 2 and not_live", sink.applied, f.feed.state)
	}
}

type lastSink struct{ distances int }

func (l *lastSink) Apply(p *results.Processed) bool { l.distances = len(p.Distances); return false }
func (l *lastSink) SetFeed(string, string)          {}

func TestFinalResultsFillInForANotLiveReplyWithoutResults(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":false,"errorMessage":"over"}`))
	}))
	defer ts.Close()

	sink := &lastSink{}
	f := &Fetcher{URL: ts.URL, Sink: sink, UA: noUA{}, Client: ts.Client(), Log: slog.Default(),
		Final: func() []byte { return []byte(`{"distances":[{"id":"d","isLive":false,"races":[]}]}`) }}
	if err := f.once(context.Background()); err != nil {
		t.Fatal(err)
	}
	if sink.distances != 1 {
		t.Fatalf("distances applied: %d", sink.distances)
	}
}
