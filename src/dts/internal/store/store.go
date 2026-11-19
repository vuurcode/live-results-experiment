// Package store keeps DTS sessions on disk: the uploaded XML, the append-only logs and the hashes of the two keys.
package store

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/vuurcode/live-results-experiment/dts/internal/dts"
)

// Role is what a key allows.
type Role int

// The two roles. A wrong key and an unknown session look the same: ErrNotFound.
const (
	Sign Role = iota + 1
	Manage
)

var (
	// ErrNotFound is returned for an unknown session and for a wrong key alike.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned by a restore over a session that has another sign key.
	ErrConflict = errors.New("session exists with another key")
	// ErrFull is returned when the store holds its maximum number of sessions.
	ErrFull = errors.New("too many sessions")
	// ErrDevices is returned when a session already has its maximum number of devices.
	ErrDevices = errors.New("too many devices")
	// ErrGone is returned by a restore of a session that was deleted on purpose.
	ErrGone = errors.New("session was deleted")
	// ErrTooBig is returned when a session would pass its size limits.
	ErrTooBig = errors.New("session too big")
)

const (
	maxOps     = 50_000
	maxActions = 200_000
	maxNotes   = 5_000
	maxCutoff  = 240
	// maxAhead is how far past the server's clock an operation's time may lie; a device with a wrong clock cannot put its changes after everyone's.
	maxAhead = 12 * time.Hour
	// maxField and maxText bound the free text of a stored line, so a session file stays small and a line stays far below the reader's buffer.
	maxField = 256
	maxText  = 2_000
)

var idPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// Config holds the limits of a store.
type Config struct {
	Dir           string
	MaxSessions   int
	Retention     time.Duration
	MaxUpload     int
	DefaultCutoff int // minutes before a race's start
	MaxDevices    int // devices that may sync one session; 0 is no limit
}

// Store is safe for concurrent use. One lock covers all sessions: the traffic is a handful of devices.
type Store struct {
	cfg Config
	// Now is the clock; tests replace it.
	Now func() time.Time
	mu  sync.Mutex
}

// New opens the store, creating its directory.
func New(cfg Config) (*Store, error) {
	if cfg.Dir == "" {
		return nil, errors.New("no data directory")
	}
	if err := os.MkdirAll(cfg.Dir, 0o750); err != nil {
		return nil, err
	}
	if cfg.DefaultCutoff == 0 {
		cfg.DefaultCutoff = 30
	}
	return &Store{cfg: cfg, Now: time.Now}, nil
}

// Action is one line of the sign page's action log. The service stores it as given.
type Action struct {
	ID    string    `json:"id"`
	At    time.Time `json:"at"`
	Kind  string    `json:"kind"`
	Entry string    `json:"entry,omitempty"`
	Old   string    `json:"old,omitempty"`
	New   string    `json:"new,omitempty"`
	Text  string    `json:"text,omitempty"`
	By    string    `json:"by,omitempty"`
	// Device is the device that made the action.
	Device string `json:"device,omitempty"`
}

// Note levels.
const (
	LevelNote    = "note"
	LevelWarning = "warning"
)

// NoteEvent adds a note ("add") or resolves it ("resolve", with NoteID). Notes are the replay of these events.
type NoteEvent struct {
	ID     string    `json:"id"`
	At     time.Time `json:"at"`
	Kind   string    `json:"kind"`
	NoteID string    `json:"noteId,omitempty"`
	Entry  string    `json:"entry,omitempty"`
	Level  string    `json:"level,omitempty"`
	Text   string    `json:"text,omitempty"`
	By     string    `json:"by"`
	Device string    `json:"device,omitempty"`
}

// Meta is what is kept about a session next to its logs.
type Meta struct {
	Created  time.Time `json:"created"`
	SignHash string    `json:"signHash"`
	// SignKey is kept so the admin overview can show the sign link again; the manage key is only ever kept as a hash.
	SignKey    string         `json:"signKey,omitempty"`
	ManageHash string         `json:"manageHash"`
	Cutoffs    map[string]int `json:"cutoffs,omitempty"`
	// Closed holds the races an admin closed: signers can no longer change them.
	Closed map[string]bool `json:"closed,omitempty"`
	// Synced is when the sign page last sent something.
	Synced time.Time `json:"synced,omitzero"`
	// Devices are the devices that have synced, by device id.
	Devices map[string]Device `json:"devices,omitempty"`
	// Changed is when the newest operation was made (its client time).
	Changed time.Time `json:"changed,omitzero"`
}

// Device is what is known about a device that uses the sign link.
type Device struct {
	Name     string    `json:"name,omitempty"`
	LastSeen time.Time `json:"lastSeen"`
	Ops      int       `json:"ops"`
	// OffsetMs is the server's clock minus the device's, in milliseconds, as of its last sync.
	OffsetMs int64 `json:"offsetMs"`
}

// Session is everything stored for one session.
type Session struct {
	ID      string
	Meta    Meta
	Source  []byte
	Ops     []dts.Op
	Actions []Action
	Notes   []NoteEvent
}

// HashKey is how a key is kept.
func HashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

func randomString(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Store) path(id string, name string) string { return filepath.Join(s.cfg.Dir, id, name) }

// Create stores an uploaded export as a new session and returns its id and the two keys; the manage key is kept as a hash only.
func (s *Store) Create(xml []byte) (id, signKey, manageKey string, err error) {
	if len(xml) > s.cfg.MaxUpload && s.cfg.MaxUpload > 0 {
		return "", "", "", ErrTooBig
	}
	if _, err := dts.Parse(xml); err != nil {
		return "", "", "", err
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", "", "", err
	}
	id = hex.EncodeToString(b)
	if signKey, err = randomString(32); err != nil {
		return "", "", "", err
	}
	if manageKey, err = randomString(32); err != nil {
		return "", "", "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.create(id, xml, signKey, HashKey(manageKey)); err != nil {
		return "", "", "", err
	}
	return id, signKey, manageKey, nil
}

func (s *Store) create(id string, xml []byte, signKey, manageHash string) error {
	if s.cfg.MaxSessions > 0 && s.countLocked() >= s.cfg.MaxSessions {
		return ErrFull
	}
	if err := os.MkdirAll(filepath.Join(s.cfg.Dir, id), 0o750); err != nil {
		return err
	}
	if err := os.WriteFile(s.path(id, "source.xml"), xml, 0o600); err != nil {
		return err
	}
	return s.writeMetaKeepingTime(id, Meta{Created: s.Now().UTC(), SignHash: HashKey(signKey), SignKey: signKey, ManageHash: manageHash})
}

func (s *Store) countLocked() int {
	entries, _ := os.ReadDir(s.cfg.Dir)
	n := 0
	for _, e := range entries {
		if e.IsDir() && idPattern.MatchString(e.Name()) {
			n++
		}
	}
	return n
}

func (s *Store) writeMeta(id string, m Meta) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := s.path(id, "meta.json.tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path(id, "meta.json"))
}

func (s *Store) readMeta(id string) (Meta, error) {
	var m Meta
	if !idPattern.MatchString(id) {
		return m, ErrNotFound
	}
	b, err := os.ReadFile(s.path(id, "meta.json"))
	if err != nil {
		return m, ErrNotFound
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, err
	}
	return m, nil
}

// Auth returns the role the key has in the session. A session that is unknown or expired, and a wrong key, are the same error.
func (s *Store) Auth(id, key string) (Role, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.readMeta(id)
	if err != nil || s.expired(id) {
		subtle.ConstantTimeCompare([]byte(HashKey(key)), []byte(HashKey("x"))) // keep the time of an unknown id like a wrong key
		return 0, ErrNotFound
	}
	h := []byte(HashKey(key))
	switch {
	case subtle.ConstantTimeCompare(h, []byte(m.SignHash)) == 1:
		if m.SignKey == "" {
			// A session made before the key was kept learns it from the first device that signs in with it.
			m.SignKey = key
			_ = s.writeMetaKeepingTime(id, m)
		}
		return Sign, nil
	case subtle.ConstantTimeCompare(h, []byte(m.ManageHash)) == 1:
		return Manage, nil
	}
	return 0, ErrNotFound
}

func (s *Store) expired(id string) bool {
	if s.cfg.Retention <= 0 {
		return false
	}
	info, err := os.Stat(s.path(id, "meta.json"))
	return err != nil || s.Now().Sub(info.ModTime()) > s.cfg.Retention
}

// touch records that the session was used, which is what the retention counts from.
func (s *Store) touch(id string) { _ = os.Chtimes(s.path(id, "meta.json"), s.Now(), s.Now()) }

func (s *Store) appendLine(id, name string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(s.path(id, name), os.O_APPEND|os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	if err := cutTornLine(f); err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.Write(append(b, '\n')); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// cutTornLine removes a last line that has no newline, left by a write a crash cut short, so the next line does not follow it.
func cutTornLine(f *os.File) error {
	fi, err := f.Stat()
	if err != nil || fi.Size() == 0 {
		return err
	}
	last := make([]byte, 1)
	if _, err := f.ReadAt(last, fi.Size()-1); err != nil || last[0] == '\n' {
		return err
	}
	const chunk = 4096
	buf := make([]byte, chunk)
	for end := fi.Size(); end > 0; {
		start := max(0, end-chunk)
		n, err := f.ReadAt(buf[:end-start], start)
		if err != nil && n == 0 {
			return err
		}
		if i := bytes.LastIndexByte(buf[:n], '\n'); i >= 0 {
			return f.Truncate(start + int64(i) + 1)
		}
		end = start
	}
	return f.Truncate(0)
}

func readLines[T any](path string) ([]T, error) {
	f, err := os.Open(path) //nolint:gosec // a path inside the store built from a checked id
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	var out []T
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	var bad error
	for sc.Scan() {
		if bad != nil {
			return nil, bad // only the last line may be damaged
		}
		var v T
		if err := json.Unmarshal(sc.Bytes(), &v); err != nil {
			bad = fmt.Errorf("%s: %w", filepath.Base(path), err)
			continue
		}
		out = append(out, v)
	}
	// a last line cut short by a crash mid-write is dropped; the line that was lost is sent again by the device
	return out, sc.Err()
}

// Load reads a whole session and counts as a use of it.
func (s *Store) Load(id string) (*Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load(id, true)
}

func (s *Store) load(id string, touch bool) (*Session, error) {
	m, err := s.readMeta(id)
	if err != nil || s.expired(id) {
		return nil, ErrNotFound
	}
	src, err := os.ReadFile(s.path(id, "source.xml"))
	if err != nil {
		return nil, err
	}
	ops, err := readLines[dts.Op](s.path(id, "ops.jsonl"))
	if err != nil {
		return nil, err
	}
	actions, err := readLines[Action](s.path(id, "actions.jsonl"))
	if err != nil {
		return nil, err
	}
	notes, err := readLines[NoteEvent](s.path(id, "notes.jsonl"))
	if err != nil {
		return nil, err
	}
	if touch {
		s.touch(id)
	}
	return &Session{ID: id, Meta: m, Source: src, Ops: ops, Actions: actions, Notes: notes}, nil
}

func (s *Store) writeMetaKeepingTime(id string, m Meta) error {
	if err := s.writeMeta(id, m); err != nil {
		return err
	}
	s.touch(id)
	return nil
}

// AppendOps stores the operations whose id is new and returns how many that was. A malformed operation refuses the whole batch.
func (s *Store) AppendOps(id string, ops []dts.Op) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return 0, err
	}
	n, err := s.appendOps(sess, ops)
	if err != nil {
		return n, err
	}
	sess.Meta.Synced = s.Now().UTC()
	return n, s.writeMetaKeepingTime(id, sess.Meta)
}

func (s *Store) appendOps(sess *Session, ops []dts.Op) (int, error) {
	for _, op := range ops {
		if err := op.Validate(); err != nil {
			return 0, err
		}
	}
	ops = withoutClosed(sess, ops)
	latest := s.Now().UTC().Add(maxAhead)
	have := map[string]bool{}
	for _, o := range sess.Ops {
		have[o.ID] = true
	}
	n := 0
	for _, op := range ops {
		if have[op.ID] {
			continue
		}
		if len(sess.Ops) >= maxOps {
			return n, ErrTooBig
		}
		if op.At.After(latest) {
			op.At = latest
		}
		if err := s.appendLine(sess.ID, "ops.jsonl", op); err != nil {
			return n, err
		}
		have[op.ID] = true
		sess.Ops = append(sess.Ops, op)
		n++
		if op.At.After(sess.Meta.Changed) {
			sess.Meta.Changed = op.At
		}
	}
	return n, nil
}

// AppendActions stores the actions whose id is new.
func (s *Store) AppendActions(id string, actions []Action) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return 0, err
	}
	n, err := s.appendActions(sess, actions)
	if err != nil {
		return n, err
	}
	sess.Meta.Synced = s.Now().UTC()
	return n, s.writeMetaKeepingTime(id, sess.Meta)
}

func validAction(a Action) error {
	if a.ID == "" || len(a.ID) > 64 || a.At.IsZero() || a.Kind == "" || len(a.Device) > 64 ||
		len(a.Kind) > 32 || len(a.Entry) > maxField || len(a.Old) > maxField || len(a.New) > maxField || len(a.Text) > maxText || len(a.By) > 32 {
		return fmt.Errorf("%w: action", dts.ErrInvalid)
	}
	return nil
}

func (s *Store) appendActions(sess *Session, actions []Action) (int, error) {
	for _, a := range actions {
		if err := validAction(a); err != nil {
			return 0, err
		}
	}
	have := map[string]bool{}
	for _, a := range sess.Actions {
		have[a.ID] = true
	}
	n := 0
	for _, a := range actions {
		if have[a.ID] {
			continue
		}
		if len(sess.Actions) >= maxActions {
			return n, ErrTooBig
		}
		if err := s.appendLine(sess.ID, "actions.jsonl", a); err != nil {
			return n, err
		}
		have[a.ID] = true
		sess.Actions = append(sess.Actions, a)
		n++
	}
	return n, nil
}

func validNote(ev NoteEvent) error {
	text := len([]rune(ev.Text))
	switch ev.Kind {
	case "add":
		if ev.Entry == "" || text == 0 || text > 200 || (ev.Level != LevelNote && ev.Level != LevelWarning) {
			return fmt.Errorf("%w: note", dts.ErrInvalid)
		}
	case "resolve":
		if ev.NoteID == "" {
			return fmt.Errorf("%w: note", dts.ErrInvalid)
		}
	default:
		return fmt.Errorf("%w: note", dts.ErrInvalid)
	}
	if ev.ID == "" || len(ev.ID) > 64 || ev.At.IsZero() || len(ev.Device) > 64 || len(ev.Entry) > maxField || len(ev.NoteID) > 64 {
		return fmt.Errorf("%w: note", dts.ErrInvalid)
	}
	return nil
}

// AddNoteEvent stores a note or its resolution. by is "sign" or "manage".
func (s *Store) AddNoteEvent(id string, ev NoteEvent) error {
	if err := validNote(ev); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return err
	}
	_, err = s.appendNotes(sess, []NoteEvent{ev})
	return err
}

func (s *Store) appendNotes(sess *Session, events []NoteEvent) (int, error) {
	for _, ev := range events {
		if err := validNote(ev); err != nil {
			return 0, err
		}
	}
	have := map[string]bool{}
	for _, n := range sess.Notes {
		have[n.ID] = true
	}
	n := 0
	for _, ev := range events {
		if have[ev.ID] {
			continue
		}
		if len(sess.Notes) >= maxNotes {
			return n, ErrTooBig
		}
		if err := s.appendLine(sess.ID, "notes.jsonl", ev); err != nil {
			return n, err
		}
		have[ev.ID] = true
		sess.Notes = append(sess.Notes, ev)
		n++
	}
	return n, nil
}

// Cursor is a position in the three logs. A device keeps the one it last received and asks for what comes after it.
type Cursor struct {
	Ops     int `json:"ops"`
	Actions int `json:"actions"`
	Notes   int `json:"notes"`
}

// SyncRequest is what a device sends: its place in the logs, and what it has made since it last synced.
type SyncRequest struct {
	Device     string      `json:"device"`
	Name       string      `json:"name"`
	ClientTime time.Time   `json:"clientTime"`
	Since      Cursor      `json:"since"`
	Ops        []dts.Op    `json:"ops"`
	Actions    []Action    `json:"actions"`
	Notes      []NoteEvent `json:"notes"`
}

// SyncResult is everything stored after the cursor, including what the request itself stored, and the new cursor.
type SyncResult struct {
	Cursor  Cursor      `json:"cursor"`
	Time    time.Time   `json:"time"`
	Ops     []dts.Op    `json:"ops"`
	Actions []Action    `json:"actions"`
	Notes   []NoteEvent `json:"notes"`
	Session *Session    `json:"-"`
}

// Sync stores what the device made, registers the device, and returns what the logs hold after the device's cursor.
// A request without a device only reads.
func (s *Store) Sync(id string, req SyncRequest) (SyncResult, error) {
	var res SyncResult
	if utf8.RuneCountInString(req.Device) > 64 || utf8.RuneCountInString(req.Name) > 40 {
		return res, fmt.Errorf("%w: device", dts.ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return res, err
	}
	now := s.Now().UTC()
	if req.Device != "" {
		if _, known := sess.Meta.Devices[req.Device]; !known && s.cfg.MaxDevices > 0 && len(sess.Meta.Devices) >= s.cfg.MaxDevices {
			return res, ErrDevices
		}
		for _, op := range req.Ops {
			if err := op.Validate(); err != nil {
				return res, err
			}
		}
		for _, a := range req.Actions {
			if err := validAction(a); err != nil {
				return res, err
			}
		}
		for i := range req.Notes {
			req.Notes[i].By = "sign"
			if err := validNote(req.Notes[i]); err != nil {
				return res, err
			}
		}
		nOps, err := s.appendOps(sess, req.Ops)
		if err != nil {
			return res, err
		}
		for i := range req.Actions {
			req.Actions[i].By = "sign"
		}
		if _, err := s.appendActions(sess, req.Actions); err != nil {
			return res, err
		}
		for i := range req.Notes {
			req.Notes[i].By = "sign"
		}
		if _, err := s.appendNotes(sess, req.Notes); err != nil {
			return res, err
		}
		if sess.Meta.Devices == nil {
			sess.Meta.Devices = map[string]Device{}
		}
		d := sess.Meta.Devices[req.Device]
		d.Name, d.LastSeen, d.Ops = req.Name, now, d.Ops+nOps
		if !req.ClientTime.IsZero() {
			d.OffsetMs = now.Sub(req.ClientTime).Milliseconds()
		}
		sess.Meta.Devices[req.Device] = d
		sess.Meta.Synced = now
		if err := s.writeMetaKeepingTime(id, sess.Meta); err != nil {
			return res, err
		}
	}
	res = SyncResult{
		Cursor:  Cursor{Ops: len(sess.Ops), Actions: len(sess.Actions), Notes: len(sess.Notes)},
		Time:    now,
		Ops:     tail(sess.Ops, req.Since.Ops),
		Actions: tail(sess.Actions, req.Since.Actions),
		Notes:   tail(sess.Notes, req.Since.Notes),
		Session: sess,
	}
	return res, nil
}

// tail returns the elements after the first n, never nil.
func tail[T any](s []T, n int) []T {
	if n < 0 || n > len(s) {
		n = 0
	}
	out := slices.Clone(s[n:])
	if out == nil {
		out = []T{}
	}
	return out
}

// SetCutoff sets the minutes before a race's start at which signing closes; a negative value restores the default.
func (s *Store) SetCutoff(id, race string, minutes int) error {
	if minutes > maxCutoff {
		return fmt.Errorf("%w: cutoff", dts.ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return err
	}
	doc, err := dts.Parse(sess.Source)
	if err != nil {
		return err
	}
	if _, ok := doc.Race(race); !ok {
		return fmt.Errorf("%w: unknown race", dts.ErrInvalid)
	}
	if sess.Meta.Cutoffs == nil {
		sess.Meta.Cutoffs = map[string]int{}
	}
	if minutes < 0 {
		delete(sess.Meta.Cutoffs, race)
	} else {
		sess.Meta.Cutoffs[race] = minutes
	}
	return s.writeMetaKeepingTime(id, sess.Meta)
}

// SetClosed closes a race to the signers, or opens it again.
func (s *Store) SetClosed(id, race string, closed bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return err
	}
	doc, err := dts.Parse(sess.Source)
	if err != nil {
		return err
	}
	if _, ok := doc.Race(race); !ok {
		return ErrNotFound
	}
	if closed {
		if sess.Meta.Closed == nil {
			sess.Meta.Closed = map[string]bool{}
		}
		sess.Meta.Closed[race] = true
	} else {
		delete(sess.Meta.Closed, race)
	}
	return s.writeMetaKeepingTime(id, sess.Meta)
}

// RemoveDevice forgets a device that synced. Its operations stay; the device is listed again when it next syncs.
func (s *Store) RemoveDevice(id, device string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, err := s.load(id, true)
	if err != nil {
		return err
	}
	if _, ok := sess.Meta.Devices[device]; !ok {
		return ErrNotFound
	}
	delete(sess.Meta.Devices, device)
	return s.writeMetaKeepingTime(id, sess.Meta)
}

// withoutClosed drops the operations that change a closed race: an entry that is in one, a racer added to one, or a move into one.
// A device is told about a closed race by the state it gets back and drops the operations itself.
func withoutClosed(sess *Session, ops []dts.Op) []dts.Op {
	if len(sess.Meta.Closed) == 0 || len(ops) == 0 {
		return ops
	}
	doc, err := dts.Parse(sess.Source)
	if err != nil {
		return ops
	}
	entries, _ := doc.Replay(sess.Ops)
	raceOf := map[string]string{}
	for _, e := range entries {
		raceOf[e.ID] = e.RaceID
	}
	out := []dts.Op{}
	for _, op := range ops {
		race := raceOf[op.Entry]
		switch {
		case op.Kind == dts.OpAddRacer:
			race = op.Race
		case op.Kind == dts.OpRace && sess.Meta.Closed[op.Value]:
			continue
		}
		if sess.Meta.Closed[race] {
			continue
		}
		// replay rejects a racer added under an id that is taken, so the id keeps the race of the entry that has it
		if _, taken := raceOf[op.ID]; op.Kind == dts.OpAddRacer && !taken {
			raceOf[op.ID] = op.Race
		}
		out = append(out, op)
	}
	return out
}

// Cutoff returns the minutes before the start at which signing closes for a race.
func (s *Store) Cutoff(m Meta, race string) int {
	if v, ok := m.Cutoffs[race]; ok {
		return v
	}
	return s.cfg.DefaultCutoff
}

// Restore recreates a session the host no longer has, or merges the device's copy into one it has with the same sign key.
func (s *Store) Restore(id, signKey, manageHash string, xml []byte, ops []dts.Op, actions []Action) error {
	if !idPattern.MatchString(id) || len(manageHash) != 64 {
		return fmt.Errorf("%w: restore", dts.ErrInvalid)
	}
	if len(xml) > s.cfg.MaxUpload && s.cfg.MaxUpload > 0 {
		return ErrTooBig
	}
	if _, err := dts.Parse(xml); err != nil {
		return err
	}
	for _, op := range ops {
		if err := op.Validate(); err != nil {
			return err
		}
	}
	s.mu.Lock()
	if _, err := os.Stat(s.tombstone(id)); err == nil {
		s.mu.Unlock()
		return ErrGone
	}
	m, err := s.readMeta(id)
	exists := err == nil && !s.expired(id)
	kept, hadKept := s.readKept(id)
	if !exists && err == nil {
		kept, hadKept = m, true
	}
	if !exists && hadKept && subtle.ConstantTimeCompare([]byte(manageHash), []byte(kept.ManageHash)) != 1 {
		s.mu.Unlock()
		return ErrConflict
	}
	if exists && subtle.ConstantTimeCompare([]byte(HashKey(signKey)), []byte(m.SignHash)) != 1 {
		s.mu.Unlock()
		return ErrConflict
	}
	if exists && m.SignKey == "" {
		m.SignKey = signKey
		_ = s.writeMetaKeepingTime(id, m)
	}
	if !exists {
		_ = os.RemoveAll(filepath.Join(s.cfg.Dir, id))
		if err := s.create(id, xml, signKey, manageHash); err != nil {
			s.mu.Unlock()
			return err
		}
		if hadKept {
			nm, err := s.readMeta(id)
			if err == nil {
				nm.Closed, nm.Cutoffs = kept.Closed, kept.Cutoffs
				_ = s.writeMetaKeepingTime(id, nm)
			}
		}
		_ = os.Remove(s.keptPath(id))
	}
	s.mu.Unlock()
	if _, err := s.AppendOps(id, ops); err != nil {
		return err
	}
	_, err = s.AppendActions(id, actions)
	return err
}

// tombstoneDir holds one empty file per session that was deleted on purpose, so a device's copy cannot bring it back.
const tombstoneDir = "deleted"

// tombstoneRetention is how long a deletion is remembered.
const tombstoneRetention = 90 * 24 * time.Hour

func (s *Store) tombstone(id string) string { return filepath.Join(s.cfg.Dir, tombstoneDir, id) }

// keptDir holds the manage hash, closed races and cutoffs of sessions deleted with the sign key, so the restore of a device's copy
// cannot give the session another manage key or reopen a closed race.
const keptDir = "kept"

func (s *Store) keptPath(id string) string { return filepath.Join(s.cfg.Dir, keptDir, id+".json") }

func (s *Store) readKept(id string) (Meta, bool) {
	var m Meta
	b, err := os.ReadFile(s.keptPath(id))
	if err != nil || json.Unmarshal(b, &m) != nil {
		return m, false
	}
	return m, true
}

// Delete removes a session at once; a device that still has a copy can restore it, under the same manage key.
func (s *Store) Delete(id string) error {
	if !idPattern.MatchString(id) {
		return ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if m, err := s.readMeta(id); err == nil {
		keep := Meta{Created: m.Created, ManageHash: m.ManageHash, Cutoffs: m.Cutoffs, Closed: m.Closed}
		if b, err := json.Marshal(keep); err == nil {
			if err := os.MkdirAll(filepath.Join(s.cfg.Dir, keptDir), 0o750); err != nil {
				return err
			}
			if err := os.WriteFile(s.keptPath(id), b, 0o600); err != nil {
				return err
			}
		}
	}
	return os.RemoveAll(filepath.Join(s.cfg.Dir, id))
}

// Remove deletes a session on purpose, for good: it is remembered, so no device's copy can bring it back.
func (s *Store) Remove(id string) error {
	if !idPattern.MatchString(id) {
		return ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Join(s.cfg.Dir, tombstoneDir), 0o750); err != nil {
		return err
	}
	if err := os.WriteFile(s.tombstone(id), nil, 0o600); err != nil {
		return err
	}
	_ = os.Remove(s.keptPath(id))
	return os.RemoveAll(filepath.Join(s.cfg.Dir, id))
}

// Info is what the overview of all sessions shows about one; it holds no names and only the sign key.
type Info struct {
	ID       string     `json:"id"`
	Created  time.Time  `json:"created"`
	LastUsed time.Time  `json:"lastUsed"`
	Races    []RaceInfo `json:"races"`
	// SignKey is empty for a session made before the key was kept, until a device syncs it.
	SignKey string `json:"signKey,omitempty"`
	Devices int    `json:"devices"`
	Ops     int    `json:"ops"`
	// DeviceList are the devices that synced, the most recently seen first.
	DeviceList []DeviceInfo `json:"deviceList"`
}

// DeviceInfo is a signing device as the admin list shows it.
type DeviceInfo struct {
	Name     string    `json:"name"`
	LastSeen time.Time `json:"lastSeen"`
	Ops      int       `json:"ops"`
}

// RaceInfo is a race as the admin list shows it.
type RaceInfo struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Closed bool   `json:"closed,omitempty"`
	// Entries are the racers in the race and Signed how many of them signed.
	Entries int `json:"entries"`
	Signed  int `json:"signed"`
}

// List returns every session, the most recently used first.
func (s *Store) List() []Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, _ := os.ReadDir(s.cfg.Dir)
	out := []Info{}
	for _, e := range entries {
		if !e.IsDir() || !idPattern.MatchString(e.Name()) {
			continue
		}
		id := e.Name()
		m, err := s.readMeta(id)
		if err != nil {
			continue
		}
		info := Info{ID: id, Created: m.Created, Races: []RaceInfo{}, Devices: len(m.Devices), SignKey: m.SignKey}
		if fi, err := os.Stat(s.path(id, "meta.json")); err == nil {
			info.LastUsed = fi.ModTime()
		}
		if sess, err := s.load(id, false); err == nil {
			if doc, err := dts.Parse(sess.Source); err == nil {
				entries, _ := doc.Replay(sess.Ops)
				for _, r := range doc.Races {
					ri := RaceInfo{ID: r.ID, Title: r.Title(), Closed: m.Closed[r.ID]}
					for _, e := range entries {
						if e.RaceID == r.ID {
							ri.Entries++
							if e.Signed {
								ri.Signed++
							}
						}
					}
					info.Races = append(info.Races, ri)
				}
			}
		}
		info.DeviceList = []DeviceInfo{}
		for did, d := range m.Devices {
			name := d.Name
			if name == "" {
				name = did
			}
			info.DeviceList = append(info.DeviceList, DeviceInfo{Name: name, LastSeen: d.LastSeen, Ops: d.Ops})
			info.Ops += d.Ops
		}
		slices.SortFunc(info.DeviceList, func(a, b DeviceInfo) int { return b.LastSeen.Compare(a.LastSeen) })
		out = append(out, info)
	}
	slices.SortFunc(out, func(a, b Info) int { return b.LastUsed.Compare(a.LastUsed) })
	return out
}

// Sweep removes the sessions that were not used within the retention and returns how many.
func (s *Store) Sweep() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, _ := os.ReadDir(s.cfg.Dir)
	n := 0
	if gone, err := os.ReadDir(filepath.Join(s.cfg.Dir, tombstoneDir)); err == nil {
		for _, g := range gone {
			if fi, err := g.Info(); err == nil && s.Now().Sub(fi.ModTime()) > tombstoneRetention {
				_ = os.Remove(s.tombstone(g.Name()))
			}
		}
	}
	if kept, err := os.ReadDir(filepath.Join(s.cfg.Dir, keptDir)); err == nil {
		for _, k := range kept {
			if fi, err := k.Info(); err == nil && s.Now().Sub(fi.ModTime()) > s.cfg.Retention && s.cfg.Retention > 0 {
				_ = os.Remove(filepath.Join(s.cfg.Dir, keptDir, k.Name()))
			}
		}
	}
	for _, e := range entries {
		if e.IsDir() && idPattern.MatchString(e.Name()) && s.expired(e.Name()) {
			if os.RemoveAll(filepath.Join(s.cfg.Dir, e.Name())) == nil {
				n++
			}
		}
	}
	return n
}
