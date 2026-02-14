package main

import (
	"os"
	"regexp"
	"strconv"
	"strings"
)

var exportRe = regexp.MustCompile(`export\s+(\w+)=["']?([^"'\n]*)["']?`)
var exportDefaultRe = regexp.MustCompile(`export\s+(\w+)="\$\{(\w+):-([^}]*)\}"`)

// loadEnvLocal reads env.local.sh and returns sensitive values.
func loadEnvLocal(path string) *EnvLocalConfig {
	cfg := &EnvLocalConfig{}
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}

	vars := parseEnvFile(string(data))
	if v, ok := vars["TF_VAR_APPLICATION_ACCOUNT_ID"]; ok {
		cfg.ApplicationAccountID = v
	}
	if v, ok := vars["TF_VAR_MANAGEMENT_ACCOUNT_ID"]; ok {
		cfg.ManagementAccountID = v
	}
	if v, ok := vars["TF_VAR_GITHUB_ORG"]; ok {
		cfg.GitHubOrg = v
	}
	if v, ok := vars["TF_VAR_FWD_EMAIL_TO_ADDRESS"]; ok {
		cfg.FwdEmailToAddress = v
	}
	if v, ok := vars["TF_VAR_SOPS_KMS_KEY_ID"]; ok {
		cfg.SOPSKMSKeyID = v
	}
	if v, ok := vars["TF_VAR_profile_prefix"]; ok {
		cfg.ProfilePrefix = v
	}

	// If terraform account not explicitly set, default to application account
	if cfg.TerraformAccountID == "" {
		cfg.TerraformAccountID = cfg.ApplicationAccountID
	}
	// SSO defaults
	if cfg.SSOStartURL == "" {
		cfg.SSOStartURL = "https://example.awsapps.com/start"
	}
	if cfg.SSOSessionName == "" {
		cfg.SSOSessionName = "Developer"
	}
	return cfg
}

// loadEnvSh reads env.sh and populates EnvConfig fields in the SiteConfig.
func loadEnvSh(path string, cfg *SiteConfig) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	vars := parseEnvFileDefaults(string(data))

	if v, ok := vars["SITE_DOMAIN"]; ok && v != "" {
		cfg.Env.SiteDomain = v
	}
	if v, ok := vars["SITE_LABEL"]; ok && v != "" {
		cfg.Env.SiteLabel = v
	}
	if v, ok := vars["AWS_REGION"]; ok && v != "" {
		cfg.Env.AWSRegion = v
	}
	if v, ok := vars["REGION_SHORT"]; ok && v != "" {
		cfg.Env.RegionShort = v
	}
	if v, ok := vars["LOCAL_RUN_PORT"]; ok {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Env.LocalPorts.Run = n
		}
	}
	if v, ok := vars["LOCAL_AUTH_PORT"]; ok {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Env.LocalPorts.Auth = n
		}
	}
	if v, ok := vars["LOCAL_GPX_PORT"]; ok {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Env.LocalPorts.GPX = n
		}
	}
	if v, ok := vars["LOCAL_CMS_PORT"]; ok {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Env.LocalPorts.CMS = n
		}
	}
}

// parseEnvFile extracts VAR=value from export statements.
func parseEnvFile(content string) map[string]string {
	result := make(map[string]string)
	for _, match := range exportRe.FindAllStringSubmatch(content, -1) {
		if len(match) >= 3 {
			result[match[1]] = match[2]
		}
	}
	return result
}

// parseEnvFileDefaults extracts default values from ${VAR:-default} patterns.
func parseEnvFileDefaults(content string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || !strings.HasPrefix(line, "export ") {
			continue
		}
		matches := exportDefaultRe.FindStringSubmatch(line)
		if len(matches) >= 4 {
			result[matches[1]] = matches[3]
			continue
		}
		matches2 := exportRe.FindStringSubmatch(line)
		if len(matches2) >= 3 {
			// Skip lines with ${} interpolation that aren't defaults
			if !strings.Contains(matches2[2], "${") {
				result[matches2[1]] = matches2[2]
			}
		}
	}
	return result
}
