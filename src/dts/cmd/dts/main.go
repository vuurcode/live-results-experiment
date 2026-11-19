// Command dts serves the DTS sign-in API on loopback, behind the proxy of the combined image.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	_ "time/tzdata" // the image has no zone database

	"github.com/vuurcode/live-results-experiment/dts/internal/api"
	"github.com/vuurcode/live-results-experiment/dts/internal/limit"
	"github.com/vuurcode/live-results-experiment/dts/internal/store"
)

func env(name, def string) string {
	if v, ok := os.LookupEnv(name); ok {
		return v
	}
	return def
}

func envInt(name string, def int) int {
	v, ok := os.LookupEnv(name)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		slog.Error("invalid setting", "name", name)
		os.Exit(2)
	}
	return n
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dir := env("DTS_DATA_DIR", "/data/dts")
	if dir == "" {
		slog.Info("DTS_DATA_DIR is empty: the sign-in service is off")
		<-ctx.Done()
		return
	}
	loc, err := time.LoadLocation(env("DTS_TIMEZONE", "Europe/Amsterdam"))
	if err != nil {
		slog.Error("invalid DTS_TIMEZONE", "error", err)
		os.Exit(2)
	}
	maxUpload := envInt("DTS_MAX_UPLOAD_BYTES", 5<<20)
	st, err := store.New(store.Config{
		Dir:           dir,
		MaxSessions:   envInt("DTS_MAX_SESSIONS", 200),
		Retention:     time.Duration(envInt("DTS_RETENTION_DAYS", 7)) * 24 * time.Hour,
		MaxUpload:     maxUpload,
		DefaultCutoff: envInt("DTS_DEFAULT_CUTOFF_MINUTES", 30),
		MaxDevices:    envInt("DTS_MAX_DEVICES", 10),
	})
	if err != nil {
		slog.Error("cannot open the data directory", "error", err)
		os.Exit(1)
	}
	srv := api.New(api.Config{
		Store:          st,
		Failures:       limit.New(30, 10),                                                                       // ten wrong keys back to back, then thirty an hour
		Creates:        limit.New(float64(envInt("DTS_CREATES_PER_HOUR", 30)), envInt("DTS_CREATES_BURST", 10)), // by default ten new sessions back to back, then thirty an hour
		ClientIPHeader: env("DTS_CLIENT_IP_HEADER", ""),
		Location:       loc,
		MaxUpload:      maxUpload,
		AdminSecret:    env("DTS_ADMIN_SECRET", ""),
	})

	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			if n := st.Sweep(); n > 0 {
				slog.Info("expired sessions removed", "count", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()

	hs := &http.Server{
		Addr:              env("DTS_LISTEN_ADDR", "127.0.0.1:5002"),
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = hs.Shutdown(shutdown)
	}()
	slog.Info("listening", "addr", hs.Addr)
	if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
