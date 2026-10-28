package prefsapi

import (
	"math"
	"sync"
	"time"
)

// limiter is a token bucket per user: each user may make burst writes at
// once, then perSecond writes a second (T-115). It keeps a signed-in
// person from rewriting prefs.json in a loop.
type limiter struct {
	perSecond float64
	burst     float64
	now       func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	at     time.Time
}

// maxBuckets bounds the map: above it, buckets that are full again (their
// users have been quiet) are dropped; if that is not enough, all are.
const maxBuckets = 4096

func newLimiter(perSecond float64, burst int, now func() time.Time) *limiter {
	return &limiter{perSecond: perSecond, burst: float64(burst), now: now, buckets: map[string]*bucket{}}
}

// take spends one token of user's bucket. When there is none, it returns
// false and how long until there is one.
func (l *limiter) take(user string) (wait time.Duration, ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b := l.buckets[user]
	if b == nil {
		if len(l.buckets) >= maxBuckets {
			l.prune(now)
		}
		b = &bucket{tokens: l.burst, at: now}
		l.buckets[user] = b
	}
	l.refill(b, now)
	if b.tokens < 1 {
		return time.Duration((1 - b.tokens) / l.perSecond * float64(time.Second)), false
	}
	b.tokens--
	return 0, true
}

func (l *limiter) refill(b *bucket, now time.Time) {
	if d := now.Sub(b.at).Seconds(); d > 0 {
		b.tokens = math.Min(l.burst, b.tokens+d*l.perSecond)
	}
	b.at = now
}

func (l *limiter) prune(now time.Time) {
	for user, b := range l.buckets {
		l.refill(b, now)
		if b.tokens >= l.burst {
			delete(l.buckets, user)
		}
	}
	if len(l.buckets) >= maxBuckets {
		l.buckets = map[string]*bucket{}
	}
}
