package main

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// --- Block isolation ---

// isolateBlock finds a named block (e.g. `name = { ... }` or `name { ... }`) and returns its inner content.
func isolateBlock(content, blockName string) (string, bool) {
	// Try assignment form first: `name = {`
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(blockName) + `\s*=\s*\{`)
	loc := pattern.FindStringIndex(content)
	if loc == nil {
		// Try HCL block form: `name {`
		pattern = regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(blockName) + `\s*\{`)
		loc = pattern.FindStringIndex(content)
	}
	if loc == nil {
		return "", false
	}

	braceStart := strings.Index(content[loc[0]:], "{") + loc[0]
	depth := 0
	for i := braceStart; i < len(content); i++ {
		switch content[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return content[braceStart+1 : i], true
			}
		}
	}
	return "", false
}

// isolateArray finds a named array assignment (e.g. `name = [ ... ]`) and returns its inner content.
func isolateArray(content, arrayName string) (string, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(arrayName) + `\s*=\s*\[`)
	loc := pattern.FindStringIndex(content)
	if loc == nil {
		return "", false
	}

	bracketStart := strings.Index(content[loc[0]:], "[") + loc[0]
	depth := 0
	for i := bracketStart; i < len(content); i++ {
		switch content[i] {
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return content[bracketStart+1 : i], true
			}
		}
	}
	return "", false
}

// splitArrayObjects splits array content into individual { ... } objects.
func splitArrayObjects(arrayContent string) []string {
	var objects []string
	depth := 0
	start := -1
	for i, ch := range arrayContent {
		switch ch {
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			depth--
			if depth == 0 && start >= 0 {
				objects = append(objects, arrayContent[start+1:i])
				start = -1
			}
		}
	}
	return objects
}

// --- Value extraction ---

func extractString(block, key string) (string, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*"([^"]*)"`)
	m := pattern.FindStringSubmatch(block)
	if m == nil {
		return "", false
	}
	return m[1], true
}

func extractBool(block, key string) (bool, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*(true|false)`)
	m := pattern.FindStringSubmatch(block)
	if m == nil {
		return false, false
	}
	return m[1] == "true", true
}

func extractInt(block, key string) (int, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*(\d+)`)
	m := pattern.FindStringSubmatch(block)
	if m == nil {
		return 0, false
	}
	v, err := strconv.Atoi(m[1])
	if err != nil {
		return 0, false
	}
	return v, true
}

func extractFloat(block, key string) (float64, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*(\d+\.?\d*)`)
	m := pattern.FindStringSubmatch(block)
	if m == nil {
		return 0, false
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

func extractStringList(block, key string) ([]string, bool) {
	arrayContent, ok := isolateArray(block, key)
	if !ok {
		return nil, false
	}
	re := regexp.MustCompile(`"([^"]*)"`)
	matches := re.FindAllStringSubmatch(arrayContent, -1)
	if len(matches) == 0 {
		return []string{}, true
	}
	result := make([]string, len(matches))
	for i, m := range matches {
		result[i] = m[1]
	}
	return result, true
}

func extractStringMap(block, key string) (map[string]string, bool) {
	subBlock, ok := isolateBlock(block, key)
	if !ok {
		return nil, false
	}
	result := map[string]string{}
	// Handle both `key = "value"` and `"key" = "value"` patterns
	re := regexp.MustCompile(`(?m)^\s*"?(\w+)"?\s*=\s*"([^"]*)"`)
	matches := re.FindAllStringSubmatch(subBlock, -1)
	for _, m := range matches {
		result[m[1]] = m[2]
	}
	return result, true
}

func extractIntMap(block, key string) (map[string]int, bool) {
	subBlock, ok := isolateBlock(block, key)
	if !ok {
		return nil, false
	}
	result := map[string]int{}
	re := regexp.MustCompile(`(?m)^\s*(\w+)\s*=\s*(\d+)`)
	matches := re.FindAllStringSubmatch(subBlock, -1)
	for _, m := range matches {
		v, err := strconv.Atoi(m[2])
		if err == nil {
			result[m[1]] = v
		}
	}
	return result, true
}

func extractRegionList(block, key string) ([]RegionRef, bool) {
	arrayContent, ok := isolateArray(block, key)
	if !ok {
		return nil, false
	}
	objects := splitArrayObjects(arrayContent)
	var regions []RegionRef
	for _, obj := range objects {
		label, lok := extractString(obj, "label")
		full, fok := extractString(obj, "full")
		if lok && fok {
			regions = append(regions, RegionRef{Label: label, Full: full})
		}
	}
	return regions, len(regions) > 0
}

func extractGetEnvDefault(block, key string) (string, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*get_env\("[^"]*",\s*"([^"]*)"\)`)
	m := pattern.FindStringSubmatch(block)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// extractFwdRules parses the fwd_rules = concat(...) block from the email section.
// It extracts match patterns and get_env defaults for each rule, and detects catch-all.
func extractFwdRules(emailBlock string) ([]FwdRule, bool, bool) {
	// Find fwd_rules = concat(
	idx := strings.Index(emailBlock, "fwd_rules")
	if idx == -1 {
		return nil, false, false
	}

	// Find the concat( opening
	concatIdx := strings.Index(emailBlock[idx:], "concat(")
	if concatIdx == -1 {
		return nil, false, false
	}
	start := idx + concatIdx + len("concat(")

	// Find matching closing paren
	depth := 1
	end := -1
	for i := start; i < len(emailBlock); i++ {
		switch emailBlock[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				end = i
				goto foundEnd
			}
		}
	}
	return nil, false, false
foundEnd:
	concatBody := emailBlock[start:end]

	// Extract individual { ... } objects from the concat body
	var rules []FwdRule
	catchAll := false

	objects := splitArrayObjects(concatBody)
	for _, obj := range objects {
		matchVal, hasMatch := extractString(obj, "match")

		// Check for catch-all: match = local.dns.zonename (unquoted)
		if !hasMatch {
			unquotedMatch := regexp.MustCompile(`(?m)^\s*match\s*=\s*local\.dns\.zonename`)
			if unquotedMatch.MatchString(obj) {
				catchAll = true
				continue
			}
			continue
		}

		// Parse the match pattern to extract the local part
		// "admin@${local.dns.zonename}" → "admin"
		// "no-reply@run.${local.dns.zonename}" → "no-reply@run"
		match := parseFwdMatch(matchVal)

		// Extract send_to default from get_env
		sendTo := ""
		if v, ok := extractGetEnvDefault(obj, "send_to"); ok {
			sendTo = v
		}

		rules = append(rules, FwdRule{Match: match, SendToDefault: sendTo})
	}

	return rules, catchAll, len(rules) > 0 || catchAll
}

// parseFwdMatch extracts the logical match pattern from a fwd_rules match string.
// "admin@${local.dns.zonename}" → "admin"
// "no-reply@run.${local.dns.zonename}" → "no-reply@run"
func parseFwdMatch(matchStr string) string {
	// Remove ${local.dns.zonename} suffix
	zoneSuffix := "${local.dns.zonename}"
	if !strings.Contains(matchStr, zoneSuffix) {
		return matchStr
	}

	// Remove the zonename reference and any trailing/leading dots
	before := strings.Replace(matchStr, zoneSuffix, "", 1)
	// "admin@" → "admin"
	// "no-reply@run." → "no-reply@run"
	before = strings.TrimSuffix(before, ".")
	before = strings.TrimSuffix(before, "@")

	// If there's an @ remaining, it means format was "local-part@sub.${zonename}"
	// e.g. "no-reply@run" which is what we want
	if before == "" {
		return matchStr
	}
	return before
}

// extractForExprSourceList extracts the source list from a for expression.
// e.g. `key = [for sub in ["a", "b"] : ...]` returns ["a", "b"]
func extractForExprSourceList(block, key string) ([]string, bool) {
	pattern := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(key) + `\s*=\s*\[for\s+\w+\s+in\s*\[([^\]]*)\]`)
	m := pattern.FindStringSubmatch(block)
	if m == nil {
		return nil, false
	}
	re := regexp.MustCompile(`"([^"]*)"`)
	matches := re.FindAllStringSubmatch(m[1], -1)
	result := make([]string, len(matches))
	for i, m := range matches {
		result[i] = m[1]
	}
	return result, len(result) > 0
}

// extractSecretDefinitions parses the secrets definitions map of objects.
func extractSecretDefinitions(block string) (map[string]SecretDefinition, bool) {
	defsBlock, ok := isolateBlock(block, "definitions")
	if !ok {
		return nil, false
	}

	result := map[string]SecretDefinition{}
	re := regexp.MustCompile(`(?m)^\s*(\w+)\s*=\s*\{`)
	allMatches := re.FindAllStringSubmatchIndex(defsBlock, -1)

	for _, idx := range allMatches {
		name := defsBlock[idx[2]:idx[3]]
		// Find the opening brace position
		braceStart := idx[0] + strings.Index(defsBlock[idx[0]:], "{")
		depth := 0
		end := -1
		for i := braceStart; i < len(defsBlock); i++ {
			switch defsBlock[i] {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					end = i
					goto found
				}
			}
		}
		continue
	found:
		objContent := defsBlock[braceStart+1 : end]
		var def SecretDefinition
		if desc, ok := extractString(objContent, "description"); ok {
			def.Description = desc
		}
		if keys, ok := extractStringList(objContent, "keys"); ok {
			def.Keys = keys
		}
		if global, ok := extractBool(objContent, "global"); ok {
			def.Global = global
		}
		result[name] = def
	}
	return result, len(result) > 0
}

// --- Site HCL import ---

// importSiteHCL reads site.hcl and returns a *SiteConfig populated from it.
// Falls back to DefaultConfig() values for anything it can't parse.
func importSiteHCL(path string) (*SiteConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	content := string(data)

	// Unwrap locals { ... } wrapper
	localsContent, ok := isolateBlock(content, "locals")
	if !ok {
		return nil, fmt.Errorf("no locals block found in %s", path)
	}

	cfg := DefaultConfig()

	// site block
	if block, ok := isolateBlock(localsContent, "site"); ok {
		if v, ok := extractString(block, "label"); ok {
			cfg.Site.Label = v
		}
		if v, ok := extractString(block, "github_repo_name"); ok {
			cfg.Site.GitHubRepoName = v
		}
		if v, ok := extractString(block, "tf_state_prefix"); ok {
			cfg.Site.TFStatePrefix = v
		}
		if v, ok := extractGetEnvDefault(block, "random_suffix"); ok {
			cfg.Site.RandomSuffix = v
		}
		if v, ok := extractStringList(block, "skip_regions"); ok {
			cfg.Site.SkipRegions = v
		}
	}

	// dns block
	if block, ok := isolateBlock(localsContent, "dns"); ok {
		if v, ok := extractString(block, "zonename"); ok {
			cfg.DNS.ZoneName = v
		}
		if v, ok := extractStringList(block, "subdomains"); ok {
			cfg.DNS.Subdomains = v
		}
		if v, ok := extractInt(block, "ttl"); ok {
			cfg.DNS.TTL = v
		}
	}

	// urls block
	if block, ok := isolateBlock(localsContent, "urls"); ok {
		if v, ok := extractStringMap(block, "subdomains"); ok {
			cfg.URLs.Subdomains = v
		}
		if v, ok := extractIntMap(block, "local_ports"); ok {
			cfg.URLs.LocalPorts = v
		}
	}

	// email block
	if block, ok := isolateBlock(localsContent, "email"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.Email.Enabled = v
		}
		if v, ok := extractString(block, "primary_region"); ok {
			cfg.Email.PrimaryRegion = v
		}
		if v, ok := extractString(block, "smtp_prefix"); ok {
			cfg.Email.SMTPPrefix = v
		}
		if v, ok := extractBool(block, "make_site_domain"); ok {
			cfg.Email.MakeSiteDomain = v
		}
		if v, ok := extractBool(block, "make_regional_domains"); ok {
			cfg.Email.MakeRegionalDomains = v
		}
		if v, ok := extractBool(block, "make_domains"); ok {
			cfg.Email.MakeDomains = v
		}
		if v, ok := extractForExprSourceList(block, "zonenames"); ok {
			cfg.Email.ZoneSubdomains = v
		}
		if v, ok := extractForExprSourceList(block, "smtp_iam_users"); ok {
			cfg.Email.SMTPIAMSubdomains = v
		}
		if v, ok := extractRegionList(block, "replica_regions"); ok {
			cfg.Email.ReplicaRegions = v
		}
		if rules, catchAll, ok := extractFwdRules(block); ok {
			cfg.Email.FwdRules = rules
			cfg.Email.CatchAllEnabled = catchAll
		}
	}

	// waf block
	if block, ok := isolateBlock(localsContent, "waf"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.WAF.Enabled = v
		}
		if v, ok := extractString(block, "log_mode"); ok {
			cfg.WAF.LogMode = v
		}
	}

	// cloudfront block
	if block, ok := isolateBlock(localsContent, "cloudfront"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.CloudFront.Enabled = v
		}
		if v, ok := extractStringList(block, "domains"); ok {
			cfg.CloudFront.Domains = v
		}
		if v, ok := extractStringMap(block, "waf_rulesets"); ok {
			cfg.CloudFront.WAFRulesets = v
		}
		if v, ok := extractRegionList(block, "regions"); ok {
			cfg.CloudFront.Regions = v
		}
		if logBlock, ok := isolateBlock(block, "logging"); ok {
			if v, ok := extractBool(logBlock, "enabled"); ok {
				cfg.CloudFront.Logging.Enabled = v
			}
			if v, ok := extractBool(logBlock, "include_cookies"); ok {
				cfg.CloudFront.Logging.IncludeCookies = v
			}
		}
		if v, ok := extractString(block, "price_class"); ok {
			cfg.CloudFront.PriceClass = v
		}
	}

	// ec2spots block
	if block, ok := isolateBlock(localsContent, "ec2spots"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.EC2Spots.Enabled = v
		}
		if instArr, ok := isolateArray(block, "instances"); ok {
			objs := splitArrayObjects(instArr)
			if len(objs) > 0 {
				inst := objs[0]
				if v, ok := extractInt(inst, "count"); ok {
					cfg.EC2Spots.Count = v
				}
				if v, ok := extractStringList(inst, "regions"); ok {
					cfg.EC2Spots.Regions = v
				}
				if v, ok := extractBool(inst, "create_dns_records"); ok {
					cfg.EC2Spots.CreateDNSRecords = v
				}
				if v, ok := extractString(inst, "instance_type"); ok {
					cfg.EC2Spots.InstanceType = v
				}
				if v, ok := extractFloat(inst, "spot_price_multiplier"); ok {
					cfg.EC2Spots.SpotPriceMultiplier = v
				}
				if v, ok := extractFloat(inst, "spot_price_offset"); ok {
					cfg.EC2Spots.SpotPriceOffset = v
				}
				if v, ok := extractInt(inst, "block_duration_minutes"); ok {
					cfg.EC2Spots.BlockDurationMin = v
				}
				if v, ok := extractString(inst, "ec2key_name_prefix"); ok {
					cfg.EC2Spots.EC2KeyNamePrefix = v
				}
			}
		}
	}

	// ecs_clusters block
	if block, ok := isolateBlock(localsContent, "ecs_clusters"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.ECSClusters.Enabled = v
		}
		if clustArr, ok := isolateArray(block, "clusters"); ok {
			objs := splitArrayObjects(clustArr)
			if len(objs) > 0 {
				cfg.ECSClusters.Clusters = nil
				for _, obj := range objs {
					cluster := ECSCluster{}
					if v, ok := extractString(obj, "name"); ok {
						cluster.Name = v
					}
					if v, ok := extractStringList(obj, "regions"); ok {
						cluster.Regions = v
					}
					if v, ok := extractBool(obj, "enable_insights"); ok {
						cluster.EnableInsights = v
					}
					if v, ok := extractString(obj, "cluster_type"); ok {
						cluster.ClusterType = v
					}
					cfg.ECSClusters.Clusters = append(cfg.ECSClusters.Clusters, cluster)
				}
			}
		}
	}

	// waffaw block
	if block, ok := isolateBlock(localsContent, "waffaw"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.Waffaw.Enabled = v
		}
		if v, ok := extractInt(block, "ec2_count"); ok {
			cfg.Waffaw.EC2Count = v
		}
		if v, ok := extractInt(block, "ec2_max_count"); ok {
			cfg.Waffaw.EC2MaxCount = v
		}
		if v, ok := extractString(block, "ec2_instance_type"); ok {
			cfg.Waffaw.EC2InstanceType = v
		}
		if v, ok := extractBool(block, "ec2_use_spot"); ok {
			cfg.Waffaw.EC2UseSpot = v
		}
		if v, ok := extractBool(block, "ec2_multi_eni"); ok {
			cfg.Waffaw.EC2MultiENI = v
		}
		if v, ok := extractInt(block, "ecs_desired_count"); ok {
			cfg.Waffaw.ECSDesiredCount = v
		}
		if v, ok := extractBool(block, "ecs_use_spot"); ok {
			cfg.Waffaw.ECSUseSpot = v
		}
		if v, ok := extractInt(block, "ecs_task_cpu"); ok {
			cfg.Waffaw.ECSTaskCPU = v
		}
		if v, ok := extractInt(block, "ecs_task_memory"); ok {
			cfg.Waffaw.ECSTaskMemory = v
		}
		if v, ok := extractString(block, "image_uri"); ok {
			cfg.Waffaw.ImageURI = v
		}
	}

	// Toggle-only modules
	for _, pair := range []struct {
		name   string
		toggle *ModuleToggle
	}{
		{"dynamodb", &cfg.DynamoDB},
		{"ecr", &cfg.ECR},
		{"ecs_services", &cfg.ECSServices},
		{"user_uploads", &cfg.UserUploads},
		{"upload_processors", &cfg.UploadProcessors},
	} {
		if block, ok := isolateBlock(localsContent, pair.name); ok {
			if v, ok := extractBool(block, "enabled"); ok {
				pair.toggle.Enabled = v
			}
		}
	}

	// ecs_tasks block (has logging fields beyond simple toggle)
	if block, ok := isolateBlock(localsContent, "ecs_tasks"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.ECSTasks.Enabled = v
		}
		if v, ok := extractBool(block, "enable_logging"); ok {
			cfg.ECSTasks.EnableLogging = v
		}
		if v, ok := extractInt(block, "log_retention_days"); ok {
			cfg.ECSTasks.LogRetentionDays = v
		}
	}

	// secrets block
	if block, ok := isolateBlock(localsContent, "secrets"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.Secrets.Enabled = v
		}
		if v, ok := extractBool(block, "use_secrets_manager"); ok {
			cfg.Secrets.UseSecretsManager = v
		}
		if v, ok := extractString(block, "primary_region"); ok {
			cfg.Secrets.PrimaryRegion = v
		}
		if v, ok := extractRegionList(block, "replica_regions"); ok {
			cfg.Secrets.ReplicaRegions = v
		}
		if v, ok := extractString(block, "ssm_prefix"); ok {
			cfg.Secrets.SSMPrefix = v
		}
		if v, ok := extractString(block, "sm_prefix"); ok {
			cfg.Secrets.SMPrefix = v
		}
		if v, ok := extractSecretDefinitions(block); ok {
			cfg.Secrets.Definitions = v
		}
	}

	// cloudtrail block
	if block, ok := isolateBlock(localsContent, "cloudtrail"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.CloudTrail.Enabled = v
		}
		if v, ok := extractBool(block, "multi_region"); ok {
			cfg.CloudTrail.MultiRegion = v
		}
		if v, ok := extractInt(block, "log_retention_days"); ok {
			cfg.CloudTrail.LogRetentionDays = v
		}
		if v, ok := extractInt(block, "glacier_transition_days"); ok {
			cfg.CloudTrail.GlacierTransitionDays = v
		}
		if v, ok := extractBool(block, "enable_access_analyzer"); ok {
			cfg.CloudTrail.EnableAccessAnalyzer = v
		}
		if v, ok := extractBool(block, "enable_athena"); ok {
			cfg.CloudTrail.EnableAthena = v
		}
		if v, ok := extractBool(block, "enable_kms_encryption"); ok {
			cfg.CloudTrail.EnableKMSEncryption = v
		}
		if v, ok := extractBool(block, "enable_alerts"); ok {
			cfg.CloudTrail.EnableAlerts = v
		}
		if v, ok := extractGetEnvDefault(block, "alert_email"); ok {
			cfg.CloudTrail.AlertEmail = v
		}
		if v, ok := extractStringList(block, "monitor_roles"); ok {
			cfg.CloudTrail.MonitorRoles = v
		}
	}

	// github_oidc_delegate_role_name (outside github_oidc block)
	// Template: "${local.site.label}-github-delegate" → extract suffix after "}-"
	if v, ok := extractString(localsContent, "github_oidc_delegate_role_name"); ok {
		if idx := strings.Index(v, "}-"); idx >= 0 {
			cfg.GitHubOIDC.DelegateRoleName = v[idx+2:]
		} else {
			cfg.GitHubOIDC.DelegateRoleName = v
		}
	}

	// github_oidc block
	if block, ok := isolateBlock(localsContent, "github_oidc"); ok {
		if v, ok := extractBool(block, "enabled"); ok {
			cfg.GitHubOIDC.Enabled = v
		}
		if profileBlock, ok := isolateBlock(block, "ec2_runner_instance_profile"); ok {
			if v, ok := extractBool(profileBlock, "enabled"); ok {
				cfg.GitHubOIDC.EC2RunnerProfile.Enabled = v
			}
			if v, ok := extractString(profileBlock, "name"); ok {
				// Template: "${local.site.label}-github-runner" → extract suffix after "}-"
				if idx := strings.Index(v, "}-"); idx >= 0 {
					cfg.GitHubOIDC.EC2RunnerProfile.Name = v[idx+2:]
				} else {
					cfg.GitHubOIDC.EC2RunnerProfile.Name = v
				}
			}
		}
	}

	return cfg, nil
}

// --- Service HCL import ---

// importServiceHCL reads a service.hcl and populates the relevant service config fields.
func importServiceHCL(path string, svcName string, cfg *SiteConfig) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	content := string(data)

	localsContent, ok := isolateBlock(content, "locals")
	if !ok {
		return fmt.Errorf("no locals block found in %s", path)
	}

	switch svcName {
	case "run.auth":
		importAuthService(localsContent, cfg)
	case "run.human":
		importHumanService(localsContent, cfg)
	case "run.cms":
		importCMSService(localsContent, cfg)
	case "run.gpx":
		importGPXService(localsContent, cfg)
	case "run.flash":
		importFlashService(localsContent, cfg)
	case "run.bib":
		importBibService(localsContent, cfg)
	}
	return nil
}

// --- Service-specific parsers ---

func importAuthService(content string, cfg *SiteConfig) {
	if taskBlock, ok := isolateBlock(content, "task"); ok {
		cfg.Services.Auth.Task = parseTaskConfig(taskBlock)
		cfg.Services.Auth.Nginx = parseContainerConfig(taskBlock, "run-auth-nginx")
		cfg.Services.Auth.App = parseContainerConfig(taskBlock, "run-auth-app")
	}
	if tables := parseDynamoDBTables(content); tables != nil {
		cfg.Services.Auth.DynamoDB = tables
	}
	if svcBlock, ok := isolateBlock(content, "service"); ok {
		cfg.Services.Auth.Service = parseServiceRunConfig(svcBlock)
	}
}

func importHumanService(content string, cfg *SiteConfig) {
	if taskBlock, ok := isolateBlock(content, "task"); ok {
		cfg.Services.Human.Task = parseTaskConfig(taskBlock)
		cfg.Services.Human.Nginx = parseContainerConfig(taskBlock, "run-human-nginx")
		cfg.Services.Human.App = parseContainerConfig(taskBlock, "run-human-app")
	}
	if tables := parseDynamoDBTables(content); tables != nil {
		cfg.Services.Human.DynamoDB = tables
	}
	if uploadsArr, ok := isolateArray(content, "user_uploads"); ok {
		objs := splitArrayObjects(uploadsArr)
		if len(objs) > 0 {
			cfg.Services.Human.Uploads = parseS3BucketConfig(objs[0])
		}
	}
	if procArr, ok := isolateArray(content, "upload_processors"); ok {
		objs := splitArrayObjects(procArr)
		if len(objs) > 0 {
			proc := objs[0]
			if lambdaBlock, ok := isolateBlock(proc, "on_upload_lambda"); ok {
				if v, ok := extractInt(lambdaBlock, "timeout"); ok {
					cfg.Services.Human.OnUploadLambda.Timeout = v
				}
				if v, ok := extractInt(lambdaBlock, "memory_size"); ok {
					cfg.Services.Human.OnUploadLambda.MemorySize = v
				}
			}
			if lambdaBlock, ok := isolateBlock(proc, "on_process_lambda"); ok {
				if v, ok := extractInt(lambdaBlock, "timeout"); ok {
					cfg.Services.Human.OnProcessLambda.Timeout = v
				}
				if v, ok := extractInt(lambdaBlock, "memory_size"); ok {
					cfg.Services.Human.OnProcessLambda.MemorySize = v
				}
			}
		}
	}
	if svcBlock, ok := isolateBlock(content, "service"); ok {
		cfg.Services.Human.Service = parseServiceRunConfig(svcBlock)
	}
}

func importCMSService(content string, cfg *SiteConfig) {
	if taskBlock, ok := isolateBlock(content, "task_master"); ok {
		cfg.Services.CMS.MasterTask = parseTaskConfig(taskBlock)
		cfg.Services.CMS.MasterNginx = parseContainerConfig(taskBlock, "run-cms-nginx")
		cfg.Services.CMS.MasterApp = parseContainerConfig(taskBlock, "run-cms-app")
	}
	if taskBlock, ok := isolateBlock(content, "task_worker"); ok {
		cfg.Services.CMS.WorkerTask = parseTaskConfig(taskBlock)
		cfg.Services.CMS.WorkerNginx = parseContainerConfig(taskBlock, "run-cms-nginx")
		cfg.Services.CMS.WorkerApp = parseContainerConfig(taskBlock, "run-cms-app")
	}
	if storageArr, ok := isolateArray(content, "cms_storage"); ok {
		objs := splitArrayObjects(storageArr)
		for _, obj := range objs {
			name, _ := extractString(obj, "name")
			switch name {
			case "cms-litestream":
				cfg.Services.CMS.Litestream = parseS3BucketConfig(obj)
			case "cms-media":
				cfg.Services.CMS.Media = parseS3BucketConfig(obj)
			}
		}
	}
	if svcBlock, ok := isolateBlock(content, "service_master"); ok {
		cfg.Services.CMS.MasterService = parseServiceRunConfig(svcBlock)
	}
	if svcBlock, ok := isolateBlock(content, "service_worker"); ok {
		cfg.Services.CMS.WorkerService = parseServiceRunConfig(svcBlock)
	}
}

func importGPXService(content string, cfg *SiteConfig) {
	if taskBlock, ok := isolateBlock(content, "task"); ok {
		cfg.Services.GPX.Task = parseTaskConfig(taskBlock)
		cfg.Services.GPX.App = parseContainerConfig(taskBlock, "run-gpx-app")
	}
	if tables := parseDynamoDBTables(content); tables != nil {
		cfg.Services.GPX.DynamoDB = tables
	}
	if storageArr, ok := isolateArray(content, "gpx_storage"); ok {
		objs := splitArrayObjects(storageArr)
		if len(objs) > 0 {
			cfg.Services.GPX.Storage = parseS3BucketConfig(objs[0])
		}
	}
	if svcBlock, ok := isolateBlock(content, "service"); ok {
		cfg.Services.GPX.Service = parseServiceRunConfig(svcBlock)
	}
}

func importFlashService(content string, cfg *SiteConfig) {
	if taskBlock, ok := isolateBlock(content, "task"); ok {
		cfg.Services.Flash.Task = parseTaskConfig(taskBlock)
		cfg.Services.Flash.Nginx = parseContainerConfig(taskBlock, "run-flash-nginx")
		cfg.Services.Flash.App = parseContainerConfig(taskBlock, "run-flash-app")
	}
	if svcBlock, ok := isolateBlock(content, "service"); ok {
		cfg.Services.Flash.Service = parseServiceRunConfig(svcBlock)
	}
}

func importBibService(content string, cfg *SiteConfig) {
	if taskBlock, ok := isolateBlock(content, "task"); ok {
		cfg.Services.Bib.Task = parseTaskConfig(taskBlock)
		cfg.Services.Bib.Nginx = parseContainerConfig(taskBlock, "run-bib-nginx")
		cfg.Services.Bib.App = parseContainerConfig(taskBlock, "run-bib-app")
	}
	if svcBlock, ok := isolateBlock(content, "service"); ok {
		cfg.Services.Bib.Service = parseServiceRunConfig(svcBlock)
	}
}

// --- Shared parsing helpers ---

func parseTaskConfig(taskBlock string) TaskConfig {
	tc := TaskConfig{}
	if v, ok := extractInt(taskBlock, "task_cpu"); ok {
		tc.TaskCPU = v
	}
	if v, ok := extractInt(taskBlock, "task_memory"); ok {
		tc.TaskMemory = v
	}
	if v, ok := extractStringList(taskBlock, "regions"); ok {
		tc.Regions = v
	}
	return tc
}

func parseContainerConfig(taskBlock, containerName string) ContainerConfig {
	cc := ContainerConfig{}
	containersArr, ok := isolateArray(taskBlock, "containers")
	if !ok {
		return cc
	}
	objects := splitArrayObjects(containersArr)
	for _, obj := range objects {
		name, _ := extractString(obj, "name")
		if name != containerName {
			continue
		}
		if v, ok := extractInt(obj, "cpu"); ok {
			cc.CPU = v
		}
		if v, ok := extractInt(obj, "memory"); ok {
			cc.Memory = v
		}
		if v, ok := extractInt(obj, "memory_reservation"); ok {
			cc.MemoryReservation = v
		}
		if hcBlock, ok := isolateBlock(obj, "health_check"); ok {
			if v, ok := extractInt(hcBlock, "interval"); ok {
				cc.HealthCheck.Interval = v
			}
			if v, ok := extractInt(hcBlock, "timeout"); ok {
				cc.HealthCheck.Timeout = v
			}
			if v, ok := extractInt(hcBlock, "retries"); ok {
				cc.HealthCheck.Retries = v
			}
			if v, ok := extractInt(hcBlock, "start_period"); ok {
				cc.HealthCheck.StartPeriod = v
			}
		}
		break
	}
	return cc
}

func parseServiceRunConfig(serviceBlock string) ServiceRunConfig {
	src := ServiceRunConfig{}
	if v, ok := extractInt(serviceBlock, "desired_count"); ok {
		src.DesiredCount = v
	}

	// health_check_path and matcher are in load_balancers[0]
	if lbArr, ok := isolateArray(serviceBlock, "load_balancers"); ok {
		lbObjs := splitArrayObjects(lbArr)
		if len(lbObjs) > 0 {
			lb := lbObjs[0]
			if v, ok := extractString(lb, "health_check_path"); ok {
				src.HealthCheckPath = v
			}
			if hcBlock, ok := isolateBlock(lb, "health_check"); ok {
				if v, ok := extractString(hcBlock, "matcher"); ok {
					src.Matcher = v
				}
			}
			// Priority is in listener block
			if listenerBlock, ok := isolateBlock(lb, "listener"); ok {
				if v, ok := extractInt(listenerBlock, "priority"); ok {
					src.Priority = v
				}
			}
		}
	}

	// Autoscaling
	if asBlock, ok := isolateBlock(serviceBlock, "autoscaling"); ok {
		if v, ok := extractBool(asBlock, "enabled"); ok {
			src.Autoscaling.Enabled = v
		}
		if v, ok := extractInt(asBlock, "min_capacity"); ok {
			src.Autoscaling.MinCapacity = v
		}
		if v, ok := extractInt(asBlock, "max_capacity"); ok {
			src.Autoscaling.MaxCapacity = v
		}
		if cpuBlock, ok := isolateBlock(asBlock, "cpu_target"); ok {
			if v, ok := extractInt(cpuBlock, "scale_out_threshold"); ok {
				src.Autoscaling.CPUScaleOut = v
			}
			if v, ok := extractInt(cpuBlock, "scale_in_threshold"); ok {
				src.Autoscaling.CPUScaleIn = v
			}
			if v, ok := extractInt(cpuBlock, "cooldown"); ok {
				src.Autoscaling.Cooldown = v
			}
		}
	}

	return src
}

func parseDynamoDBTables(content string) []DynamoDBTableConfig {
	dbBlock, ok := isolateBlock(content, "dynamodb")
	if !ok {
		return nil
	}
	tablesArr, ok := isolateArray(dbBlock, "tables")
	if !ok {
		return nil
	}
	objects := splitArrayObjects(tablesArr)
	var tables []DynamoDBTableConfig
	for _, obj := range objects {
		table := DynamoDBTableConfig{}
		if v, ok := extractString(obj, "table_name"); ok {
			table.TableName = v
		}
		if v, ok := extractString(obj, "table_type"); ok {
			table.TableType = v
		}
		if v, ok := extractBool(obj, "ttl_enabled"); ok {
			table.TTLEnabled = v
		}
		if v, ok := extractString(obj, "ttl_attribute_name"); ok {
			table.TTLAttribute = v
		}
		if v, ok := extractRegionList(obj, "replica_regions"); ok {
			table.ReplicaRegions = v
		}
		tables = append(tables, table)
	}
	return tables
}

func parseS3BucketConfig(objContent string) S3BucketConfig {
	s3 := S3BucketConfig{}
	if lcBlock, ok := isolateBlock(objContent, "lifecycle"); ok {
		if v, ok := extractInt(lcBlock, "uploads_expire_days"); ok {
			s3.UploadsExpireDays = v
		}
		if v, ok := extractBool(lcBlock, "enable_versioning"); ok {
			s3.Versioning = v
		}
	}
	if repBlock, ok := isolateBlock(objContent, "replication"); ok {
		if v, ok := extractBool(repBlock, "enabled"); ok {
			s3.ReplicationEnabled = v
		}
		if v, ok := extractRegionList(repBlock, "replica_regions"); ok {
			s3.ReplicaRegions = v
		}
	}
	if v, ok := extractBool(objContent, "full_bucket_access"); ok {
		s3.FullBucketAccess = v
	}
	if v, ok := extractBool(objContent, "cloudfront_access"); ok {
		s3.CloudFrontAccess = v
	}
	return s3
}
