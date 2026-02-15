package main

import (
	"encoding/json"
	"fmt"
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
