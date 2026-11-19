// Package limit is a token bucket per key, to slow down a client address that uploads or restores too often.
package limit

import (
	"sync"
	"time"
)

const (
	maxKeys    = 50_000
	overflow   = "\x00overflow"
	pruneEvery = time.Minute
)

// Limiter gives every key a bucket of burst tokens that refills perHour tokens an hour.
type Limiter struct {
	perSecond float64
	burst     float64
	// Now is the clock; tests replace it.
	Now func() time.Time

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastPrune time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

// New returns a limiter allowing perHour on average and burst back to back.
func New(perHour float64, burst int) *Limiter {
	return &Limiter{perSecond: perHour / 3600, burst: float64(burst), Now: time.Now, buckets: map[string]*bucket{}}
}

// Exhausted reports whether key has no attempt left, without booking one.
func (l *Limiter) Exhausted(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, found := l.buckets[key]
	if !found && len(l.buckets) >= maxKeys {
		b, found = l.buckets[overflow]
	}
	if !found {
		return false, 0
	}
	tokens := min(l.burst, b.tokens+l.Now().Sub(b.at).Seconds()*l.perSecond)
	if tokens >= 1 {
		return false, 0
	}
	if l.perSecond <= 0 {
		return true, time.Hour
	}
	return true, time.Duration((1 - tokens) / l.perSecond * float64(time.Second))
}

// Allow books one attempt for key. When it is refused, retryAfter says how long to wait.
func (l *Limiter) Allow(key string) (ok bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.Now()
	if now.Sub(l.lastPrune) > pruneEvery {
		for k, b := range l.buckets {
			if b.tokens+now.Sub(b.at).Seconds()*l.perSecond >= l.burst {
				delete(l.buckets, k)
			}
		}
		l.lastPrune = now
	}
	b, found := l.buckets[key]
	if !found {
		if len(l.buckets) >= maxKeys {
			key = overflow
			b, found = l.buckets[key]
		}
		if !found {
			b = &bucket{tokens: l.burst, at: now}
			l.buckets[key] = b
		}
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.at).Seconds()*l.perSecond)
	b.at = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	if l.perSecond <= 0 {
		return false, time.Hour
	}
	return false, time.Duration((1 - b.tokens) / l.perSecond * float64(time.Second))
}
