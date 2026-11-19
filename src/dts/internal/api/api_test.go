package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/vuurcode/live-results-experiment/dts/internal/limit"
	"github.com/vuurcode/live-results-experiment/dts/internal/store"
)

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<dataroot generated="2026-01-10T10:00:00">
<DTS_Wedstrijd><WedstrijdID>3</WedstrijdID><Start>2026-01-10T19:10:00</Start><CategorieCode>NO1</CategorieCode><Naam>NO-1</Naam></DTS_Wedstrijd>
<DTS_Wedstrijd><WedstrijdID>13</WedstrijdID><Start>2026-01-10T17:30:00</Start><CategorieCode>NO2</CategorieCode><Naam>Regio NoordOost 3</Naam><Plaats>Deventer</Plaats><Categorie>NO-2</Categorie></DTS_Wedstrijd>
<DTS_Licentiehouder><Wedstrijdnummer>1001</Wedstrijdnummer><Naam>Rider One</Naam></DTS_Licentiehouder>
<DTS_Licentiehouder><Wedstrijdnummer>1002</Wedstrijdnummer><Naam>Rider Two</Naam></DTS_Licentiehouder>
<DTS_Deelname><Wedstrijdnummer>1001</Wedstrijdnummer><WedstrijdID>3</WedstrijdID><ShowNr>11</ShowNr><Transponder1>AA-11111</Transponder1><Getekend>0</Getekend></DTS_Deelname>
<DTS_Deelname><Wedstrijdnummer>1002</Wedstrijdnummer><WedstrijdID>13</WedstrijdID><ShowNr>X1</ShowNr><Transponder1>AA-22222</Transponder1><Getekend>0</Getekend></DTS_Deelname>
</dataroot>
`

// 2026-01-10 is winter time: Amsterdam is UTC+1, so the 17:30 start is 16:30 UTC and the 30 minute cutoff 16:00 UTC.
var base = time.Date(2026, 1, 10, 15, 0, 0, 0, time.UTC)

type env struct {
	t   *testing.T
	srv *Server
	id  string
	sk  string
	mk  string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := store.New(store.Config{Dir: t.TempDir(), MaxSessions: 5, Retention: 7 * 24 * time.Hour, MaxUpload: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	st.Now = func() time.Time { return base }
	loc, _ := time.LoadLocation("Europe/Amsterdam")
	srv := New(Config{Store: st, MaxUpload: 1 << 20, Location: loc})
	srv.Now = func() time.Time { return base }
	e := &env{t: t, srv: srv}
	res := e.do("POST", "/dts-api/sessions", "", sample)
	if res.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", res.Code, res.Body)
	}
	var c created
	json.Unmarshal(res.Body.Bytes(), &c)
	e.id, e.sk, e.mk = c.ID, c.SignKey, c.ManageKey
	return e
}

func (e *env) do(method, path, key, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	req.RemoteAddr = "192.0.2.1:1234"
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

func (e *env) url(suffix string) string { return "/dts-api/sessions/" + e.id + suffix }

func (e *env) state(key string) State {
	e.t.Helper()
	res := e.do("GET", e.url(""), key, "")
	if res.Code != 200 {
		e.t.Fatalf("state: %d", res.Code)
	}
	var st State
	if err := json.Unmarshal(res.Body.Bytes(), &st); err != nil {
		e.t.Fatal(err)
	}
	return st
}

func ops(t *testing.T, list ...map[string]any) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"ops": list})
	return string(b)
}

func op(id string, mins int, kind, entry, value string) map[string]any {
	return map[string]any{"id": id, "at": base.Add(time.Duration(mins) * time.Minute), "kind": kind, "entry": entry, "value": value}
}

func TestRolesAndHeaders(t *testing.T) {
	e := newEnv(t)
	if res := e.do("GET", e.url(""), "", ""); res.Code != 404 {
		t.Errorf("no key: %d", res.Code)
	}
	if res := e.do("GET", e.url(""), "wrong", ""); res.Code != 404 {
		t.Errorf("wrong key: %d", res.Code)
	}
	res := e.do("GET", e.url(""), e.mk, "")
	for h, want := range map[string]string{"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"} {
		if res.Header().Get(h) != want {
			t.Errorf("%s = %q", h, res.Header().Get(h))
		}
	}
	// the manage key may not write operations, actions or restore; the sign key may not set a cutoff
	if res := e.do("POST", e.url("/operations"), e.mk, ops(t, op("a", 1, "cap", "1001@3", "5"))); res.Code != 404 {
		t.Errorf("manage writes ops: %d", res.Code)
	}
	if res := e.do("POST", e.url("/actions"), e.mk, `{"actions":[]}`); res.Code != 404 {
		t.Errorf("manage writes actions: %d", res.Code)
	}
	if res := e.do("PUT", e.url("/cutoff"), e.sk, `{"race":"3","minutes":10}`); res.Code != 404 {
		t.Errorf("sign sets cutoff: %d", res.Code)
	}
	if res := e.do("GET", e.url("/log"), e.mk, ""); res.Code != 404 {
		t.Errorf("manage reads the log: %d", res.Code)
	}
	if res := e.do("DELETE", e.url(""), e.mk, ""); res.Code != 404 {
		t.Errorf("manage deletes: %d", res.Code)
	}
}

func TestSignStateAndLate(t *testing.T) {
	e := newEnv(t)
	body := ops(t,
		map[string]any{"id": "a", "at": time.Date(2026, 1, 10, 15, 45, 0, 0, time.UTC), "kind": "sign", "entry": "1002@13", "value": "1"}, // 15 min before cutoff
		op("b", 2, "cap", "1001@3", "X9"),
	)
	if res := e.do("POST", e.url("/operations"), e.sk, body); res.Code != 200 || !strings.Contains(res.Body.String(), `"stored":2`) {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	st := e.state(e.mk)
	r2 := st.Races[1]
	if r2.CutoffMinutes != 30 || !r2.CutoffAt.Equal(time.Date(2026, 1, 10, 16, 0, 0, 0, time.UTC)) || r2.Signed != 1 || r2.Late != 0 {
		t.Errorf("%+v", r2)
	}
	if st.Races[0].Entries[0].Cap != "X9" || st.Totals["signed"] != 1 || st.Totals["unsigned"] != 1 {
		t.Errorf("%+v", st)
	}
	if !st.Races[0].Entries[0].Changed || st.Races[1].Entries[0].Changed {
		t.Errorf("only the entry with a new number is changed: %+v", st.Races)
	}
	if o := st.Races[0].Entries[0].Orig; o == nil || o.Cap == "" || o.Cap == "X9" || st.Races[1].Entries[0].Orig != nil {
		t.Errorf("a changed entry carries the number of the file: %+v", st.Races)
	}
	// signed 12 minutes after the 16:00 cutoff
	late := ops(t, map[string]any{"id": "c", "at": time.Date(2026, 1, 10, 16, 12, 0, 0, time.UTC), "kind": "sign", "entry": "1001@3", "value": "1"})
	e.do("POST", e.url("/operations"), e.sk, late)
	e.do("PUT", e.url("/cutoff"), e.mk, `{"race":"3","minutes":60}`)
	st = e.state(e.sk)
	if got := st.Races[0].Entries[0]; got.MinutesLate != 0 || st.Races[0].CutoffMinutes != 60 || !st.Races[0].CutoffCustom {
		t.Errorf("race 1 starts 18:10 UTC, cutoff 17:10: signing at 16:12 is on time: %+v %+v", got, st.Races[0])
	}
	e.do("PUT", e.url("/cutoff"), e.mk, `{"race":"13","minutes":90}`) // cutoff 15:00 UTC, signed 15:45
	st = e.state(e.sk)
	if got := st.Races[1].Entries[0]; got.MinutesLate != 45 || st.Races[1].Late != 1 {
		t.Errorf("%+v", got)
	}
	if len(st.Actions) == 0 || st.Actions[0].Kind != "cutoff" {
		t.Errorf("a cutoff change must be in the action log: %+v", st.Actions)
	}
	e.do("PUT", e.url("/cutoff"), e.mk, `{"race":"13"}`)
	if e.state(e.mk).Races[1].CutoffCustom {
		t.Error("no minutes restores the default")
	}
}

func TestWarningsAndInvalid(t *testing.T) {
	e := newEnv(t)
	res := e.do("POST", e.url("/operations"), e.sk, ops(t, op("a", 1, "transponder1", "1001@3", "AA-22222")))
	if res.Code != 200 {
		t.Fatal(res.Code)
	}
	if w := e.state(e.sk).Warnings; len(w) != 1 || w[0].Level != "light" {
		t.Errorf("same transponder in two races is light: %+v", w)
	}
	if res := e.do("POST", e.url("/operations"), e.sk, ops(t, op("b", 2, "cap", "1001@3", "1234"))); res.Code != 422 {
		t.Errorf("bad cap: %d", res.Code)
	}
	if res := e.do("POST", e.url("/operations"), e.sk, ops(t, op("c", 3, "transponder1", "1001@3", ""))); res.Code != 200 {
		t.Errorf("emptying a transponder is allowed: %d", res.Code)
	}
	if res := e.do("POST", e.url("/operations"), e.sk, `not json`); res.Code != 422 {
		t.Errorf("bad json: %d", res.Code)
	}
}

func TestNotes(t *testing.T) {
	e := newEnv(t)
	res := e.do("POST", e.url("/notes"), e.mk, `{"kind":"add","entry":"1001@3","level":"warning","text":"payment due"}`)
	if res.Code != 200 {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	var out map[string]string
	json.Unmarshal(res.Body.Bytes(), &out)
	notes := e.state(e.sk).Notes
	if len(notes) != 1 || notes[0].By != "manage" || notes[0].Resolved {
		t.Fatalf("%+v", notes)
	}
	e.do("POST", e.url("/notes"), e.sk, `{"kind":"resolve","noteId":"`+out["id"]+`"}`)
	if n := e.state(e.mk).Notes[0]; !n.Resolved || n.ResolvedBy != "sign" {
		t.Errorf("%+v", n)
	}
	if res := e.do("POST", e.url("/notes"), e.sk, `{"kind":"add","entry":"1001@3","level":"loud","text":"x"}`); res.Code != 422 {
		t.Errorf("%d", res.Code)
	}
}

func TestExportBothKeysAndPerRace(t *testing.T) {
	e := newEnv(t)
	e.do("POST", e.url("/operations"), e.sk, ops(t, op("a", 1, "sign", "1001@3", "1")))
	for _, key := range []string{e.sk, e.mk} {
		res := e.do("GET", e.url("/export"), key, "")
		if res.Code != 200 || !strings.Contains(res.Header().Get("Content-Disposition"), "DTS_2026-01-10_updated.xml") ||
			!strings.Contains(res.Body.String(), "<Getekend>1</Getekend>") {
			t.Fatalf("%d %v", res.Code, res.Header())
		}
	}
	res := e.do("GET", e.url("/export?race=13"), e.sk, "")
	if res.Code != 200 || !strings.Contains(res.Header().Get("Content-Disposition"), "DTS_2026-01-10_Deventer - Regio NoordOost 3 - 17.30 uur - NO-2_updated.xml") ||
		strings.Contains(res.Body.String(), "1001") {
		t.Errorf("%d %s", res.Code, res.Body)
	}
	if res := e.do("GET", e.url("/export?race=99"), e.sk, ""); res.Code != 404 {
		t.Errorf("%d", res.Code)
	}
}

func TestRestoreAfterHostLostTheSession(t *testing.T) {
	e := newEnv(t)
	e.do("POST", e.url("/operations"), e.sk, ops(t, op("a", 1, "cap", "1001@3", "X7")))
	before := e.do("GET", e.url("/export"), e.sk, "").Body.String()
	if res := e.do("DELETE", e.url(""), e.sk, ""); res.Code != 204 {
		t.Fatal(res.Code)
	}
	if res := e.do("GET", e.url(""), e.sk, ""); res.Code != 404 {
		t.Fatal("gone")
	}
	body, _ := json.Marshal(map[string]any{
		"xml": sample, "manageHash": store.HashKey(e.mk),
		"ops": []map[string]any{op("a", 1, "cap", "1001@3", "X7")},
	})
	if res := e.do("PUT", e.url(""), e.sk, string(body)); res.Code != 204 {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	if after := e.do("GET", e.url("/export"), e.sk, "").Body.String(); after != before {
		t.Errorf("the export after a restore must equal the one before")
	}
	if e.state(e.mk).Races[0].Entries[0].Cap != "X7" {
		t.Error("the manage link must show the restored state")
	}
	if res := e.do("PUT", e.url(""), "another", string(body)); res.Code != 409 {
		t.Errorf("another sign key: %d", res.Code)
	}
}

func TestWrongKeysAreRateLimited(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.Failures = limit.New(1, 3)
	e.srv.cfg.AdminSecret = "s3cret"
	for i := range 3 {
		if res := e.do("GET", e.url(""), "wrong", ""); res.Code != 404 {
			t.Fatalf("guess %d: %d", i, res.Code)
		}
	}
	if res := e.do("GET", e.url(""), "wrong", ""); res.Code != 429 || res.Header().Get("Retry-After") == "" {
		t.Errorf("fourth wrong key: %d", res.Code)
	}
	if res := e.do("GET", "/dts-api/admin/sessions", "s3cret", ""); res.Code != 429 {
		t.Errorf("a right secret from a blocked address: %d", res.Code)
	}
}

func TestOnlyFailedAttemptsAreRateLimited(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.Failures = limit.New(1, 3)
	for i := range 4 {
		if res := e.do("POST", "/dts-api/sessions", "", sample); res.Code == 429 {
			t.Fatalf("upload %d was limited", i)
		}
		e.srv.cfg.Store.Now = func() time.Time { return base }
	}
	for i := range 3 {
		if res := e.do("POST", "/dts-api/sessions", "", "not xml"); res.Code != 422 {
			t.Fatalf("refused upload %d: %d", i, res.Code)
		}
	}
	if res := e.do("POST", "/dts-api/sessions", "", sample); res.Code != 429 || res.Header().Get("Retry-After") == "" {
		t.Errorf("after the failures: %d %v", res.Code, res.Header())
	}
}

func TestUploadTooBig(t *testing.T) {
	e := newEnv(t)
	big := bytes.Repeat([]byte("x"), 2<<20)
	if res := e.do("POST", "/dts-api/sessions", "", string(big)); res.Code != 413 {
		t.Errorf("%d", res.Code)
	}
	_ = io.Discard
}

func TestClientIP(t *testing.T) {
	s := &Server{cfg: Config{ClientIPHeader: "X-Forwarded-For"}}
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:1"
	r.Header.Set("X-Forwarded-For", "1.1.1.1, 203.0.113.9")
	if got := s.clientIP(r); got != "203.0.113.9" {
		t.Errorf("last entry: %s", got)
	}
	r.Header.Set("X-Forwarded-For", "2001:db8:1:2:aaaa:bbbb:cccc:dddd")
	if got := s.clientIP(r); got != "2001:db8:1:2::/64" {
		t.Errorf("/64: %s", got)
	}
}

func (e *env) sync(key, body string) (int, map[string]json.RawMessage) {
	e.t.Helper()
	res := e.do("POST", e.url("/sync"), key, body)
	var out map[string]json.RawMessage
	json.Unmarshal(res.Body.Bytes(), &out)
	return res.Code, out
}

func syncBody(device, name string, since [3]int, clock time.Time, ops ...map[string]any) string {
	for _, o := range ops {
		o["device"] = device
	}
	b, _ := json.Marshal(map[string]any{
		"device": device, "name": name, "clientTime": clock,
		"since": map[string]int{"ops": since[0], "actions": since[1], "notes": since[2]}, "ops": ops,
	})
	return string(b)
}

func TestSyncTwoDevicesConverge(t *testing.T) {
	e := newEnv(t)
	// device A signs a racer and changes a cap, device B (a little behind) changes the same cap later
	a := syncBody("dev-a", "Desk 1", [3]int{}, base, op("a1", 1, "sign", "1001@3", "1"), op("a2", 2, "cap", "1001@3", "21"))
	code, out := e.sync(e.sk, a)
	if code != 200 {
		t.Fatal(code)
	}
	var cur struct{ Ops int }
	json.Unmarshal(out["cursor"], &cur)
	if cur.Ops != 2 {
		t.Fatalf("cursor %v", string(out["cursor"]))
	}
	// B has seen nothing yet: it sends its own and receives A's
	b := syncBody("dev-b", "Desk 2", [3]int{}, base.Add(-2*time.Second), op("b1", 3, "cap", "1001@3", "22"))
	code, out = e.sync(e.sk, b)
	var got []map[string]any
	json.Unmarshal(out["ops"], &got)
	if code != 200 || len(got) != 3 {
		t.Fatalf("B should receive all three operations: %d %s", code, out["ops"])
	}
	// A asks again from its cursor and gets only B's
	_, out = e.sync(e.sk, syncBody("dev-a", "Desk 1", [3]int{2, 0, 0}, base))
	got = nil
	json.Unmarshal(out["ops"], &got)
	if len(got) != 1 || got[0]["id"] != "b1" {
		t.Fatalf("A should receive only B's: %s", out["ops"])
	}
	// resending changes nothing
	e.sync(e.sk, a)
	st := e.state(e.mk)
	r := st.Races[0].Entries[0]
	if r.Cap != "22" || !r.Signed || r.SignedBy != "Desk 1" {
		t.Errorf("later cap wins, first signer is kept: %+v", r)
	}
	if len(st.Devices) != 2 || st.Devices[0].Name != "Desk 1" || st.Devices[0].Signs+st.Devices[0].Changes != 2 || st.Devices[1].OffsetMs != 2000 {
		t.Errorf("%+v", st.Devices)
	}
	act, _ := json.Marshal(map[string]any{"device": "dev-a", "name": "Desk 1", "clientTime": base, "since": map[string]int{}, "actions": []map[string]any{{"id": "x1", "at": base, "kind": "cap", "entry": "1001@3", "old": "1", "new": "21", "device": "dev-a"}}})
	e.sync(e.sk, string(act))
	st = e.state(e.mk)
	var full State
	if res := e.do("GET", e.url("?log=all"), e.mk, ""); res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &full) != nil || len(full.Actions) < len(st.Actions) || len(full.Actions) == 0 {
		t.Errorf("log=all carries every action: %+v", full.Actions)
	}
}

func TestSyncPermissionsLimitsAndSource(t *testing.T) {
	e := newEnv(t)
	if code, _ := e.sync(e.mk, syncBody("m", "x", [3]int{}, base)); code != 404 {
		t.Errorf("manage may not post a sync: %d", code)
	}
	if res := e.do("GET", e.url("/sync?ops=0"), e.mk, ""); res.Code != 200 {
		t.Errorf("manage may read: %d", res.Code)
	}
	if res := e.do("GET", e.url("/source"), e.mk, ""); res.Code != 404 {
		t.Errorf("manage reads the source: %d", res.Code)
	}
	if res := e.do("GET", e.url("/source"), e.sk, ""); res.Code != 200 || res.Body.String() != sample || len(res.Header().Get("X-Dts-Manage-Hash")) != 64 {
		t.Errorf("source: %d", res.Code)
	}
	if code, _ := e.sync(e.sk, `{"ops":[]}`); code != 422 {
		t.Errorf("a sync needs a device: %d", code)
	}
	e.srv.cfg.Store = mustStoreWithDevices(t, 1)
	id, sk, _ := mustCreate(t, e.srv.cfg.Store)
	e.id = id
	if code, _ := e.sync(sk, syncBody("one", "", [3]int{}, base)); code != 200 {
		t.Fatal(code)
	}
	if code, _ := e.sync(sk, syncBody("two", "", [3]int{}, base)); code != 403 {
		t.Errorf("a second device over the limit: %d", code)
	}
	if code, _ := e.sync(sk, syncBody("one", "", [3]int{}, base)); code != 200 {
		t.Errorf("a known device stays welcome: %d", code)
	}
}

func mustStoreWithDevices(t *testing.T, n int) *store.Store {
	t.Helper()
	st, err := store.New(store.Config{Dir: t.TempDir(), MaxUpload: 1 << 20, MaxDevices: n})
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func mustCreate(t *testing.T, st *store.Store) (id, sign, manage string) {
	t.Helper()
	id, sign, manage, err := st.Create([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	return
}

// Three devices each make operations and sync in a shuffled order, some requests are lost on the way back; once every
// device has synced to the end they all hold the same operations, so replaying gives the same state and the same export.
func TestSyncThreeDevicesConvergeWithLostAnswers(t *testing.T) {
	e := newEnv(t)
	type device struct {
		id     string
		cursor [3]int
		seen   map[string]map[string]any
		own    []map[string]any
	}
	mk := func(id string, ops ...map[string]any) *device {
		return &device{id: id, seen: map[string]map[string]any{}, own: ops}
	}
	devs := []*device{
		mk("d1", op("d1a", 1, "sign", "1001@3", "1"), op("d1b", 5, "cap", "1001@3", "31")),
		mk("d2", op("d2a", 2, "cap", "1001@3", "32"), op("d2b", 6, "transponder2", "1002@13", "BB-22222")),
		mk("d3", op("d3a", 3, "sign", "1002@13", "1"), op("d3b", 4, "cap", "1002@13", "X2")),
	}
	round := func(d *device, lose bool) {
		res := e.do("POST", e.url("/sync"), e.sk, syncBody(d.id, d.id, d.cursor, base, d.own...))
		if res.Code != 200 {
			t.Fatalf("%d %s", res.Code, res.Body)
		}
		if lose {
			return // the answer never arrived: the device keeps its cursor and resends
		}
		var out struct {
			Cursor struct{ Ops, Actions, Notes int }
			Ops    []map[string]any
		}
		json.Unmarshal(res.Body.Bytes(), &out)
		for _, o := range out.Ops {
			d.seen[o["id"].(string)] = o
		}
		d.cursor = [3]int{out.Cursor.Ops, out.Cursor.Actions, out.Cursor.Notes}
	}
	for i, order := range [][]int{{2, 0, 1}, {1, 2, 0}, {0, 1, 2}} {
		for _, k := range order {
			round(devs[k], (i+k)%2 == 0)
		}
	}
	for _, d := range devs { // settle: every device syncs until the end
		round(d, false)
		round(d, false)
	}
	for _, d := range devs {
		if len(d.seen) != 6 {
			t.Fatalf("%s holds %d of 6 operations", d.id, len(d.seen))
		}
	}
	st := e.state(e.mk)
	if a := st.Races[0].Entries[0]; a.Cap != "31" || !a.Signed || a.SignedBy != "d1" {
		t.Errorf("the cap set at minute 5 beats the one at minute 2: %+v", a)
	}
	if b := st.Races[1].Entries[0]; b.Cap != "X2" || b.T2 != "BB-22222" || !b.Signed || b.SignedBy != "d3" {
		t.Errorf("%+v", b)
	}
}

func TestAdminNeedsTheSecret(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.AdminSecret = "s3cret"
	list := func(key string) *httptest.ResponseRecorder { return e.do("GET", "/dts-api/admin/sessions", key, "") }
	for _, key := range []string{"", "wrong", e.sk, e.mk} {
		if res := list(key); res.Code != 404 {
			t.Errorf("key %q: %d", key, res.Code)
		}
	}
	res := list("s3cret")
	if res.Code != 200 || !strings.Contains(res.Body.String(), e.id) {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	if strings.Contains(res.Body.String(), "Rider") || strings.Contains(res.Body.String(), e.mk) || !strings.Contains(res.Body.String(), `"signKey":"`+e.sk+`"`) {
		t.Errorf("the overview must hold the sign key, no names and no manage key: %s", res.Body)
	}
	if res := e.do("GET", "/dts-api/admin/sessions/"+e.id+"/source", e.sk, ""); res.Code != 404 {
		t.Errorf("source with a session key: %d", res.Code)
	}
	if res := e.do("GET", "/dts-api/admin/sessions/"+e.id+"/source", "s3cret", ""); res.Code != 200 || !strings.Contains(res.Header().Get("Content-Disposition"), "DTS_original.xml") || !strings.Contains(res.Body.String(), "<") {
		t.Errorf("admin source: %d %v", res.Code, res.Header())
	}
	if res := e.do("DELETE", "/dts-api/admin/sessions/"+e.id, e.sk, ""); res.Code != 404 {
		t.Errorf("delete with a session key: %d", res.Code)
	}
	if res := e.do("DELETE", "/dts-api/admin/sessions/"+e.id, "s3cret", ""); res.Code != 204 {
		t.Errorf("delete: %d", res.Code)
	}
	if res := e.do("GET", e.url(""), e.sk, ""); res.Code != 404 {
		t.Errorf("deleted session: %d", res.Code)
	}
	restore := `{"xml":` + strconv.Quote(sample) + `,"manageHash":"` + store.HashKey(e.mk) + `","ops":[],"actions":[]}`
	if res := e.do("PUT", e.url(""), e.sk, restore); res.Code != http.StatusGone {
		t.Errorf("a device copy must not bring it back: %d", res.Code)
	}
}

func TestAdminReadsStateAndExport(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.AdminSecret = "s3cret"
	for _, path := range []string{"", "/export"} {
		for _, key := range []string{"", "wrong", e.sk, e.mk} {
			if res := e.do("GET", "/dts-api/admin/sessions/"+e.id+path, key, ""); res.Code != 404 {
				t.Errorf("%q key %q: %d", path, key, res.Code)
			}
		}
	}
	if res := e.do("GET", "/dts-api/admin/sessions/"+e.id, "s3cret", ""); res.Code != 200 || !strings.Contains(res.Body.String(), `"races"`) {
		t.Errorf("state: %d %s", res.Code, res.Body)
	}
	res := e.do("GET", "/dts-api/admin/sessions/"+e.id+"/export", "s3cret", "")
	if res.Code != 200 || !strings.Contains(res.Header().Get("Content-Disposition"), ".xml") {
		t.Errorf("export: %d %v", res.Code, res.Header())
	}
}

func TestAdminIsOffWithoutASecret(t *testing.T) {
	e := newEnv(t)
	for _, key := range []string{"", "x"} {
		if res := e.do("GET", "/dts-api/admin/sessions", key, ""); res.Code != 404 {
			t.Errorf("%d", res.Code)
		}
	}
}

func TestAdminClosesARace(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.AdminSecret = "s3cret"
	if res := e.do("PUT", "/dts-api/admin/sessions/"+e.id+"/races/13", "wrong", `{"closed":true}`); res.Code != 404 {
		t.Fatalf("wrong secret: %d", res.Code)
	}
	if res := e.do("PUT", "/dts-api/admin/sessions/"+e.id+"/races/99", "s3cret", `{"closed":true}`); res.Code != 404 {
		t.Fatalf("unknown race: %d", res.Code)
	}
	if res := e.do("PUT", "/dts-api/admin/sessions/"+e.id+"/races/13", "s3cret", `{"closed":true}`); res.Code != 204 {
		t.Fatalf("close: %d", res.Code)
	}
	e.do("POST", e.url("/operations"), e.sk, ops(t, op("a", 1, "sign", "1001@3", "1"), op("b", 2, "sign", "1002@13", "1")))
	state := e.do("GET", e.url(""), e.sk, "").Body.String()
	if !strings.Contains(state, `"closed":true`) {
		t.Errorf("state does not say closed: %s", state)
	}
	if log := e.do("GET", e.url(""), e.mk, "").Body.String(); !strings.Contains(log, `"kind":"close"`) || !strings.Contains(log, `"by":"sysadmin"`) {
		t.Errorf("the log does not say the sysadmin closed the race: %s", log)
	}
	export := e.do("GET", e.url("/export"), e.sk, "").Body.String()
	if strings.Count(export, "<Getekend>1</Getekend>") != 1 {
		t.Errorf("only the open race may change: %s", export)
	}
	if res := e.do("PUT", "/dts-api/admin/sessions/"+e.id+"/races/13", "s3cret", `{"closed":false}`); res.Code != 204 {
		t.Fatalf("open: %d", res.Code)
	}
	e.do("POST", e.url("/operations"), e.sk, ops(t, op("c", 3, "sign", "1002@13", "1")))
	if strings.Count(e.do("GET", e.url("/export"), e.sk, "").Body.String(), "<Getekend>1</Getekend>") != 2 {
		t.Error("an open race takes changes again")
	}
}

func TestAdminRemovesADevice(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.AdminSecret = "s3cret"
	if code, _ := e.sync(e.sk, syncBody("dev1", "Tablet", [3]int{}, base)); code != 200 {
		t.Fatalf("sync: %d", code)
	}
	path := "/dts-api/admin/sessions/" + e.id + "/devices/dev1"
	if res := e.do("DELETE", path, e.sk, ""); res.Code != 404 {
		t.Errorf("with a session key: %d", res.Code)
	}
	if res := e.do("DELETE", path, "s3cret", ""); res.Code != 204 {
		t.Errorf("remove: %d", res.Code)
	}
	if res := e.do("DELETE", path, "s3cret", ""); res.Code != 404 {
		t.Errorf("remove again: %d", res.Code)
	}
	if res := e.do("GET", "/dts-api/admin/sessions/"+e.id, "s3cret", ""); strings.Contains(res.Body.String(), "Tablet") {
		t.Errorf("the device is still listed: %s", res.Body)
	}
}

func TestSessionsPerClientAddressAreLimited(t *testing.T) {
	e := newEnv(t)
	e.srv.cfg.Creates = limit.New(1, 2)
	codes := []int{}
	for range 3 {
		codes = append(codes, e.do("POST", "/dts-api/sessions", "", sample).Code)
	}
	if codes[0] != http.StatusCreated || codes[1] != http.StatusCreated || codes[2] != http.StatusTooManyRequests {
		t.Errorf("%v", codes)
	}
}

func TestExportOfTheAddedRacersForMDS(t *testing.T) {
	e := newEnv(t)
	if res := e.do("GET", e.url("/export?format=mdsnew"), e.sk, ""); res.Code != 200 || res.Body.Len() != 0 ||
		!strings.Contains(res.Header().Get("Content-Disposition"), "_nieuw.txt") {
		t.Fatalf("nothing added: %d %v %q", res.Code, res.Header(), res.Body)
	}
	add := op("n", 1, "add-racer", "", "")
	add["who"], add["race"], add["cap"], add["t1"] = "Typed Person", "3", "X9", "HH-88888"
	if res := e.do("POST", e.url("/operations"), e.sk, ops(t, add)); res.Code != 200 && res.Code != 204 {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	res := e.do("GET", e.url("/export?format=mdsnew&race=3"), e.sk, "")
	if res.Code != 200 || !strings.HasPrefix(res.Body.String(), `"X9";"ZZ00001";"";"HH-88888"`) || !strings.Contains(res.Body.String(), "HH-88888") ||
		!strings.HasSuffix(res.Body.String(), `;"Typed Person"`+"\r\n") || !strings.HasPrefix(res.Header().Get("Content-Type"), "text/plain") {
		t.Errorf("%d %v %q", res.Code, res.Header(), res.Body)
	}
}
