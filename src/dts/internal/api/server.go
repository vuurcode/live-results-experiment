package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/vuurcode/live-results-experiment/dts/internal/dts"
	"github.com/vuurcode/live-results-experiment/dts/internal/limit"
	"github.com/vuurcode/live-results-experiment/dts/internal/store"
)

const (
	maxBatchBytes = 2 << 20
)

// Config holds what the handlers need besides the store.
type Config struct {
	Store          *store.Store
	Failures       *limit.Limiter // failed attempts only (wrong keys or secrets, refused uploads and restores), per client address; nil is no limit
	Creates        *limit.Limiter // sessions made or recreated, per client address; nil is no limit
	ClientIPHeader string
	Location       *time.Location
	MaxUpload      int
	// AdminSecret is the bearer secret of /dts-api/admin/; empty turns those calls off.
	AdminSecret string
}

// Server is the HTTP side of the service.
type Server struct {
	cfg Config
	mux *http.ServeMux
	// Now is the clock; tests replace it.
	Now func() time.Time
}

// New returns the handler for /dts-api/.
func New(cfg Config) *Server {
	if cfg.Location == nil {
		cfg.Location = time.UTC
	}
	s := &Server{cfg: cfg, mux: http.NewServeMux(), Now: time.Now}
	s.mux.HandleFunc("GET /dts-api/admin/sessions", s.adminList)
	s.mux.HandleFunc("GET /dts-api/admin/sessions/{id}", s.adminState)
	s.mux.HandleFunc("GET /dts-api/admin/sessions/{id}/export", s.adminExport)
	s.mux.HandleFunc("GET /dts-api/admin/sessions/{id}/source", s.adminSource)
	s.mux.HandleFunc("DELETE /dts-api/admin/sessions/{id}", s.adminDelete)
	s.mux.HandleFunc("DELETE /dts-api/admin/sessions/{id}/devices/{device}", s.adminRemoveDevice)
	s.mux.HandleFunc("PUT /dts-api/admin/sessions/{id}/races/{race}", s.adminClose)
	s.mux.HandleFunc("POST /dts-api/sessions", s.create)
	s.mux.HandleFunc("GET /dts-api/sessions/{id}", s.state)
	s.mux.HandleFunc("PUT /dts-api/sessions/{id}", s.restore)
	s.mux.HandleFunc("DELETE /dts-api/sessions/{id}", s.remove)
	s.mux.HandleFunc("GET /dts-api/sessions/{id}/log", s.log)
	s.mux.HandleFunc("POST /dts-api/sessions/{id}/operations", s.operations)
	s.mux.HandleFunc("POST /dts-api/sessions/{id}/actions", s.postActions)
	s.mux.HandleFunc("GET /dts-api/sessions/{id}/actions", s.getActions)
	s.mux.HandleFunc("POST /dts-api/sessions/{id}/notes", s.notes)
	s.mux.HandleFunc("PUT /dts-api/sessions/{id}/cutoff", s.cutoff)
	s.mux.HandleFunc("GET /dts-api/sessions/{id}/export", s.export)
	s.mux.HandleFunc("GET /dts-api/sessions/{id}/source", s.source)
	s.mux.HandleFunc("POST /dts-api/sessions/{id}/sync", s.syncPost)
	s.mux.HandleFunc("GET /dts-api/sessions/{id}/sync", s.syncGet)
	return s
}

// ServeHTTP adds the headers every answer carries.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Robots-Tag", "noindex, nofollow")
	h.Set("Content-Security-Policy", "default-src 'none'")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) clientIP(r *http.Request) string {
	raw := r.RemoteAddr
	if s.cfg.ClientIPHeader != "" {
		if v := r.Header.Get(s.cfg.ClientIPHeader); v != "" {
			raw = v[strings.LastIndex(v, ",")+1:]
		}
	}
	raw = strings.TrimSpace(raw)
	if ap, err := netip.ParseAddrPort(raw); err == nil {
		raw = ap.Addr().String()
	}
	addr, err := netip.ParseAddr(raw)
	if err != nil {
		return raw
	}
	if addr.Is6() && !addr.Is4In6() {
		p, _ := addr.Prefix(64)
		return p.String()
	}
	return addr.Unmap().String()
}

// guessBlocked refuses a client address that has used up its wrong guesses, whatever key it sends next.
func (s *Server) guessBlocked(w http.ResponseWriter, r *http.Request) bool {
	if s.cfg.Failures == nil {
		return false
	}
	if out, wait := s.cfg.Failures.Exhausted(s.clientIP(r)); out {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		http.Error(w, "too many requests", http.StatusTooManyRequests)
		return true
	}
	return false
}

// refused books an upload or restore the service turned away as wrong. A full service, a deleted list or a server fault is not the client's doing.
func (s *Server) refused(r *http.Request, err error) {
	for _, bad := range []error{store.ErrNotFound, store.ErrConflict, store.ErrTooBig, dts.ErrInvalid} {
		if errors.Is(err, bad) {
			s.wrongGuess(r)
			return
		}
	}
}

// createBlocked books a new session against the client address and refuses it once the address made too many.
func (s *Server) createBlocked(w http.ResponseWriter, r *http.Request) bool {
	if s.cfg.Creates == nil {
		return false
	}
	ok, wait := s.cfg.Creates.Allow(s.clientIP(r))
	if !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		http.Error(w, "too many requests", http.StatusTooManyRequests)
	}
	return !ok
}

// wrongGuess books a wrong key or secret against the client address.
func (s *Server) wrongGuess(r *http.Request) {
	if s.cfg.Failures != nil {
		s.cfg.Failures.Allow(s.clientIP(r))
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, store.ErrGone):
		http.Error(w, "gone", http.StatusGone)
	case errors.Is(err, store.ErrConflict):
		http.Error(w, "conflict", http.StatusConflict)
	case errors.Is(err, store.ErrDevices):
		http.Error(w, "too many devices", http.StatusForbidden)
	case errors.Is(err, store.ErrFull):
		w.Header().Set("Retry-After", "3600")
		http.Error(w, "full", http.StatusServiceUnavailable)
	case errors.Is(err, store.ErrTooBig):
		http.Error(w, "too big", http.StatusRequestEntityTooLarge)
	case errors.Is(err, dts.ErrInvalid):
		http.Error(w, "invalid", http.StatusUnprocessableEntity)
	default:
		slog.Error("request failed", "error", err)
		http.Error(w, "error", http.StatusInternalServerError)
	}
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// auth checks the key against the session and the roles allowed. A role that is not allowed answers 404 like a wrong key.
func (s *Server) auth(w http.ResponseWriter, r *http.Request, allowed ...store.Role) (string, store.Role, bool) {
	if s.guessBlocked(w, r) {
		return "", 0, false
	}
	id := r.PathValue("id")
	role, err := s.cfg.Store.Auth(id, bearer(r))
	if err != nil || !contains(allowed, role) {
		s.wrongGuess(r)
		http.Error(w, "not found", http.StatusNotFound)
		return "", 0, false
	}
	return id, role, true
}

func contains(rs []store.Role, r store.Role) bool {
	for _, x := range rs {
		if x == r {
			return true
		}
	}
	return false
}

func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	if limit <= 0 { // like the store, 0 means no limit
		limit = math.MaxInt64
	}
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		http.Error(w, "too big", http.StatusRequestEntityTooLarge)
		return nil, false
	}
	return b, true
}

func decode[T any](w http.ResponseWriter, r *http.Request, limit int64) (T, bool) {
	var v T
	b, ok := readBody(w, r, limit)
	if !ok {
		return v, false
	}
	if err := json.Unmarshal(b, &v); err != nil {
		http.Error(w, "invalid", http.StatusUnprocessableEntity)
		return v, false
	}
	return v, true
}

type created struct {
	ID        string   `json:"id"`
	SignKey   string   `json:"signKey"`
	ManageKey string   `json:"manageKey"`
	Warnings  []string `json:"warnings"`
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	if s.guessBlocked(w, r) {
		return
	}
	body, ok := readBody(w, r, int64(s.cfg.MaxUpload))
	if !ok {
		s.wrongGuess(r)
		return
	}
	if s.createBlocked(w, r) {
		return
	}
	id, sign, manage, err := s.cfg.Store.Create(body)
	if err != nil {
		s.refused(r, err)
		fail(w, err)
		return
	}
	warnings, _ := validate(body)
	writeJSON(w, http.StatusCreated, created{ID: id, SignKey: sign, ManageKey: manage, Warnings: warnings})
}

// validate runs the checks of a fresh export that are worth telling the person about. They never refuse the file.
func validate(src []byte) ([]string, error) {
	doc, err := dts.Parse(src)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, w := range dts.Warnings(doc.Entries) {
		out = append(out, w.Level+" "+w.Kind+" "+w.Value)
	}
	return out, nil
}

func (s *Server) load(w http.ResponseWriter, id string) (*store.Session, bool) {
	sess, err := s.cfg.Store.Load(id)
	if err != nil {
		fail(w, err)
		return nil, false
	}
	return sess, true
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign, store.Manage)
	if !ok {
		return
	}
	s.writeState(w, id, r.URL.Query().Get("log") == "all")
}

// writeState answers the state; fullLog carries every action instead of the latest ones.
func (s *Server) writeState(w http.ResponseWriter, id string, fullLog bool) {
	sess, ok := s.load(w, id)
	if !ok {
		return
	}
	st, _, _, err := BuildState(sess, s.cfg.Store.Cutoff, s.cfg.Location, s.Now())
	if err != nil {
		fail(w, err)
		return
	}
	if fullLog {
		st.Actions = slices.Clone(sess.Actions)
		slices.Reverse(st.Actions)
		if st.Actions == nil {
			st.Actions = []store.Action{}
		}
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) log(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign)
	if !ok {
		return
	}
	sess, ok := s.load(w, id)
	if !ok {
		return
	}
	ops := sess.Ops
	if ops == nil {
		ops = []dts.Op{}
	}
	writeJSON(w, http.StatusOK, ops)
}

func (s *Server) operations(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign)
	if !ok {
		return
	}
	req, ok := decode[struct {
		Ops []dts.Op `json:"ops"`
	}](w, r, maxBatchBytes)
	if !ok {
		return
	}
	n, err := s.cfg.Store.AppendOps(id, req.Ops)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"stored": n})
}

func (s *Server) postActions(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign)
	if !ok {
		return
	}
	req, ok := decode[struct {
		Actions []store.Action `json:"actions"`
	}](w, r, maxBatchBytes)
	if !ok {
		return
	}
	for i := range req.Actions {
		req.Actions[i].By = "sign"
	}
	n, err := s.cfg.Store.AppendActions(id, req.Actions)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"stored": n})
}

func (s *Server) getActions(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign, store.Manage)
	if !ok {
		return
	}
	sess, ok := s.load(w, id)
	if !ok {
		return
	}
	actions := sess.Actions
	if actions == nil {
		actions = []store.Action{}
	}
	writeJSON(w, http.StatusOK, actions)
}

func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Server) notes(w http.ResponseWriter, r *http.Request) {
	id, role, ok := s.auth(w, r, store.Sign, store.Manage)
	if !ok {
		return
	}
	ev, ok := decode[store.NoteEvent](w, r, 16<<10)
	if !ok {
		return
	}
	ev.By = "sign"
	if role == store.Manage {
		ev.By = "manage"
	}
	if ev.ID == "" {
		ev.ID = randomID()
	}
	if ev.At.IsZero() {
		ev.At = s.Now().UTC()
	}
	if err := s.cfg.Store.AddNoteEvent(id, ev); err != nil {
		fail(w, err)
		return
	}
	if role == store.Manage {
		s.logManageNote(id, ev)
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": ev.ID})
}

// logManageNote puts a note added or solved on the manage page in the action log, with the note's text. Signing
// devices log their own notes.
func (s *Server) logManageNote(id string, ev store.NoteEvent) {
	act := store.Action{ID: randomID(), At: ev.At, Kind: "note-add", By: "manage", Entry: ev.Entry, Text: ev.Text}
	if ev.Kind == "resolve" {
		act.Kind, act.Text = "note-resolve", ""
		if sess, err := s.cfg.Store.Load(id); err == nil {
			var imported []dts.ImportedNote
			if doc, err := dts.Parse(sess.Source); err == nil {
				imported = doc.ImportedNotes()
			}
			for _, n := range replayNotes(imported, sess.Notes) {
				if n.ID == ev.NoteID {
					act.Text = n.Text
				}
			}
		}
	}
	_, _ = s.cfg.Store.AppendActions(id, []store.Action{act})
}

func (s *Server) cutoff(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Manage)
	if !ok {
		return
	}
	req, ok := decode[struct {
		Race    string `json:"race"`
		Minutes *int   `json:"minutes"` // absent or null: back to the default
	}](w, r, 4<<10)
	if !ok {
		return
	}
	minutes := -1
	if req.Minutes != nil {
		minutes = *req.Minutes
		if minutes < 0 {
			fail(w, dts.ErrInvalid)
			return
		}
	}
	if err := s.cfg.Store.SetCutoff(id, req.Race, minutes); err != nil {
		fail(w, err)
		return
	}
	// The change is part of the action log, with who set it.
	_, _ = s.cfg.Store.AppendActions(id, []store.Action{{
		ID: randomID(), At: s.Now().UTC(), Kind: "cutoff", By: "manage", Entry: "race " + req.Race, New: strconv.Itoa(minutes),
	}})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign, store.Manage)
	if !ok {
		return
	}
	s.writeExport(w, r, id)
}

func (s *Server) writeExport(w http.ResponseWriter, r *http.Request, id string) {
	sess, ok := s.load(w, id)
	if !ok {
		return
	}
	_, entries, doc, err := BuildState(sess, s.cfg.Store.Cutoff, s.cfg.Location, s.Now())
	if err != nil {
		fail(w, err)
		return
	}
	race := r.URL.Query().Get("race")
	if race != "" {
		if _, ok := doc.Race(race); !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	}
	now := s.Now().In(s.cfg.Location)
	name := exportName(doc, race)
	var out []byte
	contentType := "application/xml; charset=utf-8"
	switch r.URL.Query().Get("format") {
	case "tekenlijst":
		out = doc.ExportTekenlijst(entries, race, now)
		name = strings.Replace(name, "_updated.xml", "_tekenlijst.xml", 1)
	case "mdsnew":
		if out, _, err = doc.ExportMDSNew(entries, race); err != nil {
			fail(w, err)
			return
		}
		name = mdsNewName(doc, race)
		contentType = "text/plain; charset=windows-1252"
	default:
		if out, _, err = doc.Export(sess.Source, entries, race, now); err != nil {
			fail(w, err)
			return
		}
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Disposition", `attachment; filename="`+name+`"`)
	_, _ = w.Write(out) //nolint:gosec // a download served as an attachment, not rendered
}

func (s *Server) remove(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign)
	if !ok {
		return
	}
	// The sign key's delete is the host's own cleanup: a device's copy may restore the list. The admin's delete is the one for good.
	if err := s.cfg.Store.Delete(id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) restore(w http.ResponseWriter, r *http.Request) {
	if s.guessBlocked(w, r) {
		return
	}
	req, ok := decode[struct {
		XML        string         `json:"xml"`
		ManageHash string         `json:"manageHash"`
		Ops        []dts.Op       `json:"ops"`
		Actions    []store.Action `json:"actions"`
	}](w, r, int64(s.cfg.MaxUpload)*2+maxBatchBytes)
	if !ok {
		s.wrongGuess(r)
		return
	}
	key := bearer(r)
	if key == "" {
		s.wrongGuess(r)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if s.createBlocked(w, r) {
		return
	}
	for i := range req.Actions {
		req.Actions[i].By = "sign"
	}
	if err := s.cfg.Store.Restore(r.PathValue("id"), key, req.ManageHash, []byte(req.XML), req.Ops, req.Actions); err != nil {
		s.refused(r, err)
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type syncResponse struct {
	Cursor  store.Cursor      `json:"cursor"`
	Time    time.Time         `json:"time"`
	Ops     []dts.Op          `json:"ops"`
	Actions []store.Action    `json:"actions"`
	Notes   []store.NoteEvent `json:"notes"`
	State   *State            `json:"state"`
}

func (s *Server) syncResponse(w http.ResponseWriter, res store.SyncResult) {
	st, _, _, err := BuildState(res.Session, s.cfg.Store.Cutoff, s.cfg.Location, s.Now())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, syncResponse{Cursor: res.Cursor, Time: res.Time, Ops: res.Ops, Actions: res.Actions, Notes: res.Notes, State: st})
}

// syncPost stores what a device made and answers with what the other devices made, in one round trip.
func (s *Server) syncPost(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign)
	if !ok {
		return
	}
	req, ok := decode[store.SyncRequest](w, r, maxBatchBytes)
	if !ok {
		return
	}
	if req.Device == "" {
		fail(w, dts.ErrInvalid)
		return
	}
	res, err := s.cfg.Store.Sync(id, req)
	if err != nil {
		fail(w, err)
		return
	}
	s.syncResponse(w, res)
}

// syncGet reads what came after the cursor in the query (ops, actions, notes) and registers nothing.
func (s *Server) syncGet(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign, store.Manage)
	if !ok {
		return
	}
	q := r.URL.Query()
	num := func(name string) int { n, _ := strconv.Atoi(q.Get(name)); return n }
	res, err := s.cfg.Store.Sync(id, store.SyncRequest{Since: store.Cursor{Ops: num("ops"), Actions: num("actions"), Notes: num("notes")}})
	if err != nil {
		fail(w, err)
		return
	}
	s.syncResponse(w, res)
}

// source answers the XML as it was uploaded, for a device that joins with the link alone.
func (s *Server) source(w http.ResponseWriter, r *http.Request) {
	id, _, ok := s.auth(w, r, store.Sign)
	if !ok {
		return
	}
	sess, ok := s.load(w, id)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	// The hash of the manage key lets any signing device recreate the session later; it cannot be used as the key.
	w.Header().Set("X-Dts-Manage-Hash", sess.Meta.ManageHash)
	_, _ = w.Write(sess.Source)
}

// admin answers false, and has answered, unless the call carries the admin secret. Without a configured secret the calls do not exist.
func (s *Server) admin(w http.ResponseWriter, r *http.Request) bool {
	if s.cfg.AdminSecret == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return false
	}
	if s.guessBlocked(w, r) {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(store.HashKey(bearer(r))), []byte(store.HashKey(s.cfg.AdminSecret))) != 1 {
		s.wrongGuess(r)
		http.Error(w, "not found", http.StatusNotFound)
		return false
	}
	return true
}

func (s *Server) adminList(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": s.cfg.Store.List()})
}

// SysAdmin is the name the action log gives to what the admin did.
const SysAdmin = "sysadmin"

func (s *Server) adminClose(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	req, ok := decode[struct {
		Closed bool `json:"closed"`
	}](w, r, 1024)
	if !ok {
		return
	}
	if err := s.cfg.Store.SetClosed(r.PathValue("id"), r.PathValue("race"), req.Closed); err != nil {
		fail(w, err)
		return
	}
	kind := "reopen"
	if req.Closed {
		kind = "close"
	}
	// Closing and reopening are part of the action log, as the system administrator's.
	_, _ = s.cfg.Store.AppendActions(r.PathValue("id"), []store.Action{{
		ID: randomID(), At: s.Now().UTC(), Kind: kind, By: SysAdmin, Entry: "race " + r.PathValue("race"),
	}})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminDelete(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	if err := s.cfg.Store.Remove(r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminRemoveDevice forgets a signing device of a list.
func (s *Server) adminRemoveDevice(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	if err := s.cfg.Store.RemoveDevice(r.PathValue("id"), r.PathValue("device")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminState(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	s.writeState(w, r.PathValue("id"), r.URL.Query().Get("log") == "all")
}

// adminSource answers the XML as it was uploaded, as a download.
func (s *Server) adminSource(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	sess, ok := s.load(w, r.PathValue("id"))
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="DTS_original.xml"`)
	_, _ = w.Write(sess.Source)
}

func (s *Server) adminExport(w http.ResponseWriter, r *http.Request) {
	if !s.admin(w, r) {
		return
	}
	s.writeExport(w, r, r.PathValue("id"))
}
