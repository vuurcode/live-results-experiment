package limit

import (
	"testing"
	"time"
)

func TestLimiter(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := New(6, 2) // one every ten minutes, two back to back
	l.Now = func() time.Time { return now }
	for range 2 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatal("burst")
		}
	}
	ok, wait := l.Allow("a")
	if ok || wait < 9*time.Minute || wait > 11*time.Minute {
		t.Errorf("%v %v", ok, wait)
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Error("keys are separate")
	}
	now = now.Add(11 * time.Minute)
	if ok, _ := l.Allow("a"); !ok {
		t.Error("refilled")
	}
}

func TestExhaustedSeesTheOverflowBucketOfAFullTable(t *testing.T) {
	l := New(1, 1)
	for i := range maxKeys {
		l.buckets[string(rune(i+1))+"k"] = &bucket{tokens: 0, at: l.Now()}
	}
	l.Allow("new-a") // takes the only token of the shared overflow bucket
	if out, _ := l.Exhausted("new-b"); !out {
		t.Error("a new key on a full table shares the exhausted overflow bucket")
	}
}
