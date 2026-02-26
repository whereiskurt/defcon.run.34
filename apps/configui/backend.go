package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// handleBackendCheck tests whether the Terraform state S3 buckets exist.
// Returns {ok: true} if all buckets exist, or {ok: false, missing: [...]} with the
// missing bucket names. Used as a pre-flight check before plan/apply on fresh forks.
func (a *App) handleBackendCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	a.mu.RLock()
	cfg := a.config
	envLocal := a.envLocal
	a.mu.RUnlock()

	prefix := cfg.Site.TFStatePrefix
	suffix := cfg.Site.RandomSuffix
	if prefix == "" || suffix == "" {
		json.NewEncoder(w).Encode(struct {
			OK bool `json:"ok"`
		}{OK: true}) // can't determine bucket names — skip check
		return
	}

	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	// Check each region's state bucket
	var missing []string
	for _, reg := range AllRegions() {
		bucket := fmt.Sprintf("%s-%s-%s", prefix, reg.Label, suffix)
		if !s3BucketExists(profile, bucket, reg.Full) {
			missing = append(missing, bucket)
		}
	}

	resp := struct {
		OK      bool     `json:"ok"`
		Missing []string `json:"missing,omitempty"`
	}{
		OK:      len(missing) == 0,
		Missing: missing,
	}
	json.NewEncoder(w).Encode(resp)
}

// s3BucketExists checks if an S3 bucket exists using head-bucket.
func s3BucketExists(profile, bucket, region string) bool {
	cmd := exec.Command("aws", "s3api", "head-bucket",
		"--bucket", bucket,
		"--region", region,
		"--profile", profile)
	// Strip stale credential env vars
	for _, e := range os.Environ() {
		switch {
		case strings.HasPrefix(e, "AWS_ACCESS_KEY_ID="),
			strings.HasPrefix(e, "AWS_SECRET_ACCESS_KEY="),
			strings.HasPrefix(e, "AWS_SESSION_TOKEN="):
			continue
		default:
			cmd.Env = append(cmd.Env, e)
		}
	}
	cmd.Env = append(cmd.Env, "AWS_PROFILE="+profile)
	return cmd.Run() == nil
}
