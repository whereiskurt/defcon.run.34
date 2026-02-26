package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// sopsCmd creates an exec.Cmd for sops with a clean AWS environment.
// Sets AWS_PROFILE and strips any stale credential env vars so sops
// always resolves fresh credentials through the profile/SSO chain.
func sopsCmd(profile string, args ...string) *exec.Cmd {
	cmd := exec.Command("sops", args...)
	// Inherit parent env but strip stale credential vars
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
	if profile != "" {
		cmd.Env = append(cmd.Env, "AWS_PROFILE="+profile)
	}
	return cmd
}

// sopsDecrypt runs sops decrypt and returns parsed secret values.
// Returns map[secretName] -> map[keyName] -> value.
// Skips the "sops" metadata key.
func sopsDecrypt(path, profile string) (map[string]map[string]string, error) {
	cmd := sopsCmd(profile, "decrypt", path)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("sops decrypt failed: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("sops decrypt failed: %w", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse decrypted JSON: %w", err)
	}

	result := make(map[string]map[string]string)
	for key, val := range raw {
		if key == "sops" {
			continue
		}
		switch v := val.(type) {
		case map[string]interface{}:
			m := make(map[string]string)
			for k, vv := range v {
				m[k] = fmt.Sprintf("%v", vv)
			}
			result[key] = m
		case string:
			result[key] = map[string]string{"value": v}
		default:
			result[key] = map[string]string{"value": fmt.Sprintf("%v", v)}
		}
	}
	return result, nil
}

// sopsSaveSecret decrypts the SOPS file, merges one secret's values, and re-encrypts.
func sopsSaveSecret(sopsPath, profile, name string, values map[string]string) error {
	// Decrypt current file
	cmd := sopsCmd(profile, "decrypt", sopsPath)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("sops decrypt failed: %s", string(exitErr.Stderr))
		}
		return fmt.Errorf("sops decrypt failed: %w", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(out, &raw); err != nil {
		return fmt.Errorf("failed to parse decrypted JSON: %w", err)
	}

	// Remove sops metadata (will be re-added on encrypt)
	delete(raw, "sops")

	// Merge updated values
	secretMap := make(map[string]interface{})
	for k, v := range values {
		secretMap[k] = v
	}
	raw[name] = secretMap

	// Write plaintext to temp file (sibling .secrets.json matches .sops.yaml regex)
	dir := filepath.Dir(sopsPath)
	tempPath := filepath.Join(dir, ".secrets.json")
	plaintext, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}
	if err := os.WriteFile(tempPath, plaintext, 0600); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}
	defer os.Remove(tempPath)

	// Encrypt temp file
	encCmd := sopsCmd(profile, "encrypt", tempPath)
	encrypted, err := encCmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("sops encrypt failed: %s", string(exitErr.Stderr))
		}
		return fmt.Errorf("sops encrypt failed: %w", err)
	}

	// Write encrypted output back to original file
	if err := os.WriteFile(sopsPath, encrypted, 0644); err != nil {
		return fmt.Errorf("failed to write encrypted file: %w", err)
	}

	return nil
}

// sopsAvailable checks if the sops CLI is installed and the file exists.
func sopsAvailable(sopsPath string) bool {
	if _, err := exec.LookPath("sops"); err != nil {
		return false
	}
	if _, err := os.Stat(sopsPath); err != nil {
		return false
	}
	return true
}

// sopsAlreadyConfigured checks if .sops.yaml exists and contains KMS ARNs
// that belong to the given account ID. Returns false if the ARNs reference a
// different account (e.g., upstream project keys on a fresh fork).
func sopsAlreadyConfigured(repoRoot, accountID string) bool {
	data, err := os.ReadFile(filepath.Join(repoRoot, ".sops.yaml"))
	if err != nil {
		return false
	}
	content := string(data)
	if !strings.Contains(content, "arn:aws:kms:") {
		return false
	}
	// If we know the account ID, verify the ARNs actually reference it
	if accountID != "" {
		return strings.Contains(content, ":"+accountID+":")
	}
	return true
}

// handleSOPSSetup runs env.sops.sh --not-dry-run and returns JSON status.
func (a *App) handleSOPSSetup(w http.ResponseWriter, r *http.Request) {
	a.mu.RLock()
	envLocal := a.envLocal
	a.mu.RUnlock()

	// Guard: don't create duplicate KMS keys if SOPS is already configured for this account
	if sopsAlreadyConfigured(a.repoRoot, envLocal.ApplicationAccountID) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct {
			OK     bool   `json:"ok"`
			Output string `json:"output"`
		}{OK: true, Output: "SOPS is already configured (.sops.yaml has KMS ARNs). No action taken."})
		return
	}

	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	scriptPath := filepath.Join(a.repoRoot, "env.sops.sh")

	cmd := exec.Command("bash", scriptPath, "--not-dry-run")
	cmd.Dir = a.repoRoot

	// Build a clean environment like buildTerminalEnv
	var env []string
	stripKeys := map[string]bool{
		"AWS_PROFILE":           true,
		"AWS_ACCESS_KEY_ID":     true,
		"AWS_SECRET_ACCESS_KEY": true,
		"AWS_SESSION_TOKEN":     true,
	}
	for _, e := range os.Environ() {
		key := e
		if idx := strings.IndexByte(e, '='); idx >= 0 {
			key = e[:idx]
		}
		if !stripKeys[key] {
			env = append(env, e)
		}
	}
	env = append(env, "AWS_PROFILE="+profile)
	env = append(env, "TF_VAR_profile_prefix="+envLocal.ProfilePrefix)
	env = append(env, "TF_VAR_APPLICATION_ACCOUNT_ID="+envLocal.ApplicationAccountID)
	cmd.Env = env

	out, err := cmd.CombinedOutput()

	a.invalidateAWSStatusCache()

	w.Header().Set("Content-Type", "application/json")
	resp := struct {
		OK     bool   `json:"ok"`
		Output string `json:"output"`
	}{
		OK:     err == nil,
		Output: string(out),
	}
	json.NewEncoder(w).Encode(resp)
}

// handleSOPSCheck tests whether SOPS can decrypt .secrets.sops.json.
// Returns {ok: true} on success or {ok: false, error: "..."} on failure.
// Used as a pre-flight check before plan/apply to fail fast on fork misconfigs.
func (a *App) handleSOPSCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !sopsAvailable(a.sopsFilePath) {
		json.NewEncoder(w).Encode(struct {
			OK    bool   `json:"ok"`
			Error string `json:"error,omitempty"`
		}{OK: true}) // no SOPS file = nothing to check
		return
	}

	a.mu.RLock()
	profile := "terraform"
	if a.envLocal.ProfilePrefix != "" {
		profile = a.envLocal.ProfilePrefix + "-terraform"
	}
	a.mu.RUnlock()

	cmd := sopsCmd(profile, "decrypt", a.sopsFilePath)
	_, err := cmd.Output()

	resp := struct {
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}{OK: err == nil}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			resp.Error = string(exitErr.Stderr)
		} else {
			resp.Error = err.Error()
		}
	}
	json.NewEncoder(w).Encode(resp)
}
