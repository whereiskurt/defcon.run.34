package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"strconv"
	"strings"
)

func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	tmpl, err := template.New("layout.html").Funcs(template.FuncMap{
		"contains": func(slice []string, item string) bool {
			for _, s := range slice {
				if s == item {
					return true
				}
			}
			return false
		},
		"join": strings.Join,
		"truncMid": func(s string, keep int, args ...string) template.HTML {
			mode := ""
			if len(args) > 0 {
				mode = args[0]
			}
			if len(s) <= keep*2 {
				return template.HTML(template.HTMLEscapeString(s))
			}
			head := template.HTMLEscapeString(s[:keep])
			tail := template.HTMLEscapeString(s[len(s)-keep:])
			if mode == "blur" {
				return template.HTML(head + `<span class="pii-blur" onclick="this.classList.toggle('pii-revealed')" title="Click to reveal">` + tail + `</span>`)
			}
			return template.HTML(head + ".." + tail)
		},
		"mapHas": func(m map[string]string, key string) bool {
			_, ok := m[key]
			return ok
		},
		"mapGet": func(m map[string]string, key string) string {
			return m[key]
		},
		"hasRegion": func(regions []RegionRef, label string) bool {
			for _, r := range regions {
				if r.Label == label {
					return true
				}
			}
			return false
		},
		"hasRegionStr": func(regions []string, region string) bool {
			for _, r := range regions {
				if r == region {
					return true
				}
			}
			return false
		},
		"versionSync": func() map[string]map[string]bool {
			return versionSyncStatus(a.repoRoot, a.config.Versions)
		},
	}).ParseFS(content, "templates/layout.html", "templates/form.html", "templates/partials/*.html")
	if err != nil {
		http.Error(w, fmt.Sprintf("Template error: %v", err), 500)
		log.Printf("Template parse error: %v", err)
		return
	}

	data := struct {
		Config   *SiteConfig
		EnvLocal *EnvLocalConfig
	}{
		Config:   a.config,
		EnvLocal: a.envLocal,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		log.Printf("Template execute error: %v", err)
	}
}

func (a *App) handleSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	// Backup before saving
	backupPath, err := a.createBackup()
	if err != nil {
		log.Printf("Backup failed: %v", err)
	}

	// Parse form into config
	cfg := a.parseForm(r)
	a.config = cfg

	// Parse env.local.sh fields (not stored in JSON)
	envLocal := a.parseEnvLocalForm(r)
	a.envLocal = envLocal

	// Save JSON sidecar
	if err := SaveConfig(a.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), 500)
		return
	}

	// Generate site.hcl
	if err := generateSiteHCL(a.siteHCLPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate site.hcl: %v", err), 500)
		return
	}

	// Generate service.hcl files
	if err := generateServiceHCLs(a.servicesDir, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate service.hcl: %v", err), 500)
		return
	}

	// Generate env.sh
	if err := generateEnvSh(a.envShPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate env.sh: %v", err), 500)
		return
	}

	// Generate env.local.sh
	if err := generateEnvLocalSh(a.envLocalShPath, envLocal); err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate env.local.sh: %v", err), 500)
		return
	}

	// Write VERSION files
	if err := writeVersions(a.repoRoot, cfg.Versions); err != nil {
		http.Error(w, fmt.Sprintf("Failed to write versions: %v", err), 500)
		return
	}

	msg := "Configuration saved successfully."
	if backupPath != "" {
		msg += fmt.Sprintf(" Backup: %s", backupPath)
	}

	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, `<div id="save-result" class="px-4 py-2 rounded-md bg-green-900/30 text-green-400 text-sm">%s</div>`, msg)
}

func (a *App) handlePreview(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Failed to parse form", 400)
		return
	}

	cfg := a.parseForm(r)
	envLocal := a.parseEnvLocalForm(r)

	type previewTab struct {
		ID    string
		Label string
		Body  string
	}

	var tabs []previewTab

	// site.hcl
	if out, err := renderSiteHCL(cfg); err == nil {
		tabs = append(tabs, previewTab{"sitehcl", "site.hcl", out})
	} else {
		http.Error(w, fmt.Sprintf("Failed to generate site.hcl: %v", err), 500)
		return
	}

	// Service HCLs
	for _, svc := range []struct{ name, label string }{
		{"run.auth", "auth"},
		{"run.human", "human"},
		{"run.cms", "cms"},
		{"run.gpx", "gpx"},
	} {
		if out, err := renderServiceHCL(svc.name, cfg); err == nil {
			tabs = append(tabs, previewTab{"svc-" + svc.label, svc.name + "/service.hcl", out})
		} else {
			log.Printf("Preview: skip %s: %v", svc.name, err)
		}
	}

	// env.sh
	if out, err := renderEnvSh(cfg); err == nil {
		tabs = append(tabs, previewTab{"envsh", "env.sh", out})
	} else {
		log.Printf("Preview: skip env.sh: %v", err)
	}

	// env.local.sh
	if out, err := renderEnvLocalSh(envLocal); err == nil {
		tabs = append(tabs, previewTab{"envlocal", "env.local.sh", out})
	} else {
		log.Printf("Preview: skip env.local.sh: %v", err)
	}

	tabActive := `px-3 py-1.5 text-xs font-medium border-b-2 border-cyan-500 text-cyan-600 dark:text-cyan-400`
	tabInactive := `px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 cursor-pointer`
	copyBtn := `rounded-md bg-zinc-700 hover:bg-zinc-600 px-2 py-1 text-xs text-zinc-300`
	stickyBar := `sticky top-0 z-10 flex justify-end py-1 bg-zinc-900/90 backdrop-blur-sm`
	preClass := `text-xs font-mono bg-zinc-900 text-zinc-300 p-4 pl-6 rounded-lg overflow-auto whitespace-pre`

	w.Header().Set("Content-Type", "text/html")

	// Build tab IDs array for JS
	var tabIDs []string
	for _, t := range tabs {
		tabIDs = append(tabIDs, `'`+t.ID+`'`)
	}

	// Tab buttons
	fmt.Fprint(w, `<div>`)
	fmt.Fprintf(w, `<div class="flex flex-wrap gap-1 border-b border-zinc-700 mb-3">`)
	for i, t := range tabs {
		cls := tabInactive
		if i == 0 {
			cls = tabActive
		}
		fmt.Fprintf(w, `<button type="button" onclick="switchPreviewTab('%s')" id="ptab-%s" class="%s">%s</button>`,
			t.ID, t.ID, cls, template.HTMLEscapeString(t.Label))
	}
	fmt.Fprint(w, `</div>`)

	// Tab content panes
	for i, t := range tabs {
		hidden := ""
		if i > 0 {
			hidden = ` class="hidden"`
		}
		fmt.Fprintf(w, `<div id="ptab-content-%s"%s><div class="%s"><button onclick="copyPreviewTab('%s')" class="%s">Copy</button></div><pre id="pre-%s" class="%s">%s</pre></div>`,
			t.ID, hidden, stickyBar, t.ID, copyBtn, t.ID, preClass, template.HTMLEscapeString(t.Body))
	}

	// Tab switching JS — also updates _previewState.tab for restore across refreshes
	fmt.Fprintf(w, `<script>
function switchPreviewTab(tab) {
  if (typeof _previewState !== 'undefined') _previewState.tab = tab;
  [%s].forEach(function(t) {
    document.getElementById('ptab-content-'+t).classList.toggle('hidden', t !== tab);
    var btn = document.getElementById('ptab-'+t);
    btn.className = t === tab ? %q : %q;
  });
}
</script></div>`, strings.Join(tabIDs, ","), tabActive, tabInactive)
}

func (a *App) handleExport(w http.ResponseWriter, r *http.Request) {
	data, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		http.Error(w, "Failed to marshal config", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=site-config.json")
	w.Write(data)
}

func (a *App) handleAWSStatus(w http.ResponseWriter, r *http.Request) {
	prefix := r.URL.Query().Get("prefix")
	suffix := r.URL.Query().Get("suffix")
	regionsParam := r.URL.Query().Get("regions")

	if prefix == "" {
		prefix = a.config.Site.TFStatePrefix
	}
	if suffix == "" {
		suffix = a.config.Site.RandomSuffix
	}

	regions := []string{"use1", "cac1", "apse1"}
	if regionsParam != "" {
		regions = strings.Split(regionsParam, ",")
	}

	status := checkAWSStatus(prefix, suffix, regions, a.envLocal.ProfilePrefix)
	status.SSOSession = a.envLocal.SSOSessionName

	tmpl, err := template.New("aws_status.html").Funcs(template.FuncMap{
		"truncMid": func(s string, keep int, args ...string) template.HTML {
			mode := ""
			if len(args) > 0 {
				mode = args[0]
			}
			if len(s) <= keep*2 {
				return template.HTML(template.HTMLEscapeString(s))
			}
			head := template.HTMLEscapeString(s[:keep])
			tail := template.HTMLEscapeString(s[len(s)-keep:])
			if mode == "blur" {
				return template.HTML(head + `<span class="pii-blur" onclick="this.classList.toggle('pii-revealed')" title="Click to reveal">` + tail + `</span>`)
			}
			return template.HTML(head + ".." + tail)
		},
	}).ParseFS(content, "templates/partials/aws_status.html")
	if err != nil {
		http.Error(w, fmt.Sprintf("Template error: %v", err), 500)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	if err := tmpl.Execute(w, status); err != nil {
		log.Printf("AWS status template error: %v", err)
	}
}

func (a *App) handleSSOLogin(w http.ResponseWriter, r *http.Request) {
	session := a.envLocal.SSOSessionName
	if session == "" {
		session = "Developer"
	}
	out, err := runSSOLogin(session)
	w.Header().Set("Content-Type", "text/html")
	// Always trigger a status refresh after SSO login attempt
	w.Header().Set("HX-Trigger", "refreshAwsStatus")
	if err != nil {
		fmt.Fprintf(w, `<div class="py-2"><span class="text-xs text-red-400">SSO login failed: %s</span></div>`, template.HTMLEscapeString(out))
	} else {
		fmt.Fprintf(w, `<div class="py-2"><span class="text-xs text-green-400">SSO login complete for session: %s</span></div>`, template.HTMLEscapeString(session))
	}
}

func (a *App) handleExportCreds(w http.ResponseWriter, r *http.Request) {
	profile := "terraform"
	if a.envLocal.ProfilePrefix != "" {
		profile = a.envLocal.ProfilePrefix + "-terraform"
	}
	out, err := runExportCredentials(profile)
	w.Header().Set("Content-Type", "text/html")
	w.Header().Set("HX-Trigger", "refreshAwsStatus")
	if err != nil {
		fmt.Fprintf(w, `<div class="rounded-lg border border-red-700 bg-red-900/20 px-4 py-3 text-xs text-red-400">Export failed: %s</div>`, template.HTMLEscapeString(out))
	} else {
		escaped := template.HTMLEscapeString(out)
		fmt.Fprintf(w, `<div class="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3">
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs text-green-400 font-medium">Credentials exported for profile: %s</span>
    <div class="flex items-center gap-2">
      <button onclick="var pre=document.getElementById('creds-output'); navigator.clipboard.writeText(pre.dataset.raw).then(function(){this.textContent='Copied!'; var b=this; setTimeout(function(){b.textContent='Copy';},1500);}.bind(this));"
              class="rounded-md bg-zinc-700 hover:bg-zinc-600 px-2 py-1 text-xs text-zinc-300">Copy</button>
      <button onclick="document.getElementById('aws-action-result').innerHTML='';"
              class="text-zinc-500 hover:text-zinc-300 text-lg px-1" title="Dismiss">&times;</button>
    </div>
  </div>
  <pre id="creds-output" class="pii-blur font-mono text-xs text-zinc-300 bg-zinc-900 rounded p-3 overflow-x-auto whitespace-pre cursor-pointer"
       data-raw="%s"
       onclick="this.classList.toggle('pii-revealed');"
       title="Click to reveal/blur">%s</pre>
</div>`, template.HTMLEscapeString(profile), escaped, escaped)
	}
}

// parseForm reads form values into a SiteConfig.
func (a *App) parseForm(r *http.Request) *SiteConfig {
	cfg := DefaultConfig()

	// Site identity
	cfg.Site.Label = formStr(r, "site.label", cfg.Site.Label)
	cfg.Site.GitHubRepoName = formStr(r, "site.github_repo_name", cfg.Site.GitHubRepoName)
	cfg.Site.TFStatePrefix = formStr(r, "site.tf_state_prefix", cfg.Site.TFStatePrefix)
	cfg.Site.RandomSuffix = formStr(r, "site.random_suffix", cfg.Site.RandomSuffix)
	cfg.Site.SkipRegions = formCSV(r, "site.skip_regions")

	// DNS
	cfg.DNS.ZoneName = formStr(r, "dns.zonename", cfg.DNS.ZoneName)
	cfg.DNS.Subdomains = formCSV(r, "dns.subdomains")
	cfg.DNS.TTL = formInt(r, "dns.ttl", cfg.DNS.TTL)

	// URLs
	cfg.URLs.Subdomains = map[string]string{
		"auth": formStr(r, "urls.subdomains.auth", "auth"),
		"run":  formStr(r, "urls.subdomains.run", "run"),
		"gpx":  formStr(r, "urls.subdomains.gpx", "gpx"),
		"cms":  formStr(r, "urls.subdomains.cms", "cms"),
	}
	cfg.URLs.LocalPorts = map[string]int{
		"auth": formInt(r, "urls.local_ports.auth", 3002),
		"run":  formInt(r, "urls.local_ports.run", 3001),
		"gpx":  formInt(r, "urls.local_ports.gpx", 3003),
		"cms":  formInt(r, "urls.local_ports.cms", 1337),
	}

	// Env
	cfg.Env.SiteDomain = formStr(r, "env.site_domain", cfg.Env.SiteDomain)
	cfg.Env.SiteLabel = formStr(r, "env.site_label", cfg.Env.SiteLabel)
	cfg.Env.AWSRegion = formStr(r, "env.aws_region", cfg.Env.AWSRegion)
	cfg.Env.RegionShort = formStr(r, "env.region_short", cfg.Env.RegionShort)
	cfg.Env.LocalPorts.Run = formInt(r, "env.local_ports.run", cfg.Env.LocalPorts.Run)
	cfg.Env.LocalPorts.Auth = formInt(r, "env.local_ports.auth", cfg.Env.LocalPorts.Auth)
	cfg.Env.LocalPorts.GPX = formInt(r, "env.local_ports.gpx", cfg.Env.LocalPorts.GPX)
	cfg.Env.LocalPorts.CMS = formInt(r, "env.local_ports.cms", cfg.Env.LocalPorts.CMS)

	// Email
	cfg.Email.Enabled = formBool(r, "email.enabled")
	cfg.Email.PrimaryRegion = formStr(r, "email.primary_region", cfg.Email.PrimaryRegion)
	cfg.Email.SMTPPrefix = formStr(r, "email.smtp_prefix", cfg.Email.SMTPPrefix)
	cfg.Email.MakeSiteDomain = formBool(r, "email.make_site_domain")
	cfg.Email.MakeRegionalDomains = formBool(r, "email.make_regional_domains")
	cfg.Email.MakeDomains = formBool(r, "email.make_domains")
	cfg.Email.ReplicaRegions = formRegions(r, "email.regions")

	// WAF
	cfg.WAF.Enabled = formBool(r, "waf.enabled")
	cfg.WAF.LogMode = formStr(r, "waf.log_mode", cfg.WAF.LogMode)

	// CloudFront
	cfg.CloudFront.Enabled = formBool(r, "cloudfront.enabled")
	cfg.CloudFront.Domains = formCSV(r, "cloudfront.domains")
	cfg.CloudFront.PriceClass = formStr(r, "cloudfront.price_class", cfg.CloudFront.PriceClass)
	cfg.CloudFront.Logging.Enabled = formBool(r, "cloudfront.logging.enabled")
	cfg.CloudFront.Logging.IncludeCookies = formBool(r, "cloudfront.logging.include_cookies")
	cfg.CloudFront.Regions = formRegions(r, "cloudfront.regions")
	// WAF rulesets
	cfg.CloudFront.WAFRulesets = make(map[string]string)
	for _, domain := range cfg.CloudFront.Domains {
		key := fmt.Sprintf("cloudfront.waf_rulesets.%s", domain)
		if v := r.FormValue(key); v != "" {
			cfg.CloudFront.WAFRulesets[domain] = v
		}
	}

	// EC2 Spots
	cfg.EC2Spots.Enabled = formBool(r, "ec2spots.enabled")
	cfg.EC2Spots.Count = formInt(r, "ec2spots.count", 0)
	cfg.EC2Spots.InstanceType = formStr(r, "ec2spots.instance_type", "t4g.medium")
	cfg.EC2Spots.CreateDNSRecords = formBool(r, "ec2spots.create_dns_records")
	cfg.EC2Spots.SpotPriceMultiplier = formFloat(r, "ec2spots.spot_price_multiplier", 1.00)
	cfg.EC2Spots.SpotPriceOffset = formFloat(r, "ec2spots.spot_price_offset", 0.0005)
	cfg.EC2Spots.BlockDurationMin = formInt(r, "ec2spots.block_duration_minutes", 0)
	cfg.EC2Spots.EC2KeyNamePrefix = formStr(r, "ec2spots.ec2key_name_prefix", "ec2spot")
	cfg.EC2Spots.Regions = formCSV(r, "ec2spots.regions")
	if len(cfg.EC2Spots.Regions) == 0 {
		cfg.EC2Spots.Regions = []string{"us-east-1", "ca-central-1", "ap-southeast-1"}
	}

	// ECS Clusters
	cfg.ECSClusters.Enabled = formBool(r, "ecs_clusters.enabled")
	if len(cfg.ECSClusters.Clusters) > 0 {
		cfg.ECSClusters.Clusters[0].Name = formStr(r, "ecs_clusters.0.name", "app")
		cfg.ECSClusters.Clusters[0].ClusterType = formStr(r, "ecs_clusters.0.cluster_type", "FARGATE")
		cfg.ECSClusters.Clusters[0].EnableInsights = formBool(r, "ecs_clusters.0.enable_insights")
	}

	// Module toggles
	cfg.DynamoDB.Enabled = formBool(r, "dynamodb.enabled")
	cfg.ECR.Enabled = formBool(r, "ecr.enabled")
	cfg.ECSTasks.Enabled = formBool(r, "ecs_tasks.enabled")
	cfg.ECSServices.Enabled = formBool(r, "ecs_services.enabled")
	cfg.UserUploads.Enabled = formBool(r, "user_uploads.enabled")
	cfg.UploadProcessors.Enabled = formBool(r, "upload_processors.enabled")

	// Secrets
	cfg.Secrets.Enabled = formBool(r, "secrets.enabled")
	cfg.Secrets.UseSecretsManager = formBool(r, "secrets.use_secrets_manager")
	cfg.Secrets.PrimaryRegion = formStr(r, "secrets.primary_region", cfg.Secrets.PrimaryRegion)

	// CloudTrail
	cfg.CloudTrail.Enabled = formBool(r, "cloudtrail.enabled")
	cfg.CloudTrail.MultiRegion = formBool(r, "cloudtrail.multi_region")
	cfg.CloudTrail.LogRetentionDays = formInt(r, "cloudtrail.log_retention_days", 90)
	cfg.CloudTrail.GlacierTransitionDays = formInt(r, "cloudtrail.glacier_transition_days", 0)
	cfg.CloudTrail.EnableAccessAnalyzer = formBool(r, "cloudtrail.enable_access_analyzer")
	cfg.CloudTrail.EnableAthena = formBool(r, "cloudtrail.enable_athena")
	cfg.CloudTrail.EnableKMSEncryption = formBool(r, "cloudtrail.enable_kms_encryption")
	cfg.CloudTrail.EnableAlerts = formBool(r, "cloudtrail.enable_alerts")
	cfg.CloudTrail.AlertEmail = formStr(r, "cloudtrail.alert_email", "")
	cfg.CloudTrail.MonitorRoles = formCSV(r, "cloudtrail.monitor_roles")

	// GitHub OIDC
	cfg.GitHubOIDC.Enabled = formBool(r, "github_oidc.enabled")
	cfg.GitHubOIDC.EC2RunnerProfile.Enabled = formBool(r, "github_oidc.ec2_runner.enabled")
	cfg.GitHubOIDC.EC2RunnerProfile.Name = formStr(r, "github_oidc.ec2_runner.name", "github-runner")

	// Service configs
	parseServiceForm(r, cfg)

	// Versions
	cfg.Versions.Auth.App = formStr(r, "versions.auth.app", cfg.Versions.Auth.App)
	cfg.Versions.Auth.Nginx = formStr(r, "versions.auth.nginx", cfg.Versions.Auth.Nginx)
	cfg.Versions.Human.App = formStr(r, "versions.human.app", cfg.Versions.Human.App)
	cfg.Versions.Human.Nginx = formStr(r, "versions.human.nginx", cfg.Versions.Human.Nginx)
	cfg.Versions.CMS.App = formStr(r, "versions.cms.app", cfg.Versions.CMS.App)
	cfg.Versions.CMS.Nginx = formStr(r, "versions.cms.nginx", cfg.Versions.CMS.Nginx)
	cfg.Versions.GPX.App = formStr(r, "versions.gpx.app", cfg.Versions.GPX.App)

	return cfg
}

func (a *App) parseEnvLocalForm(r *http.Request) *EnvLocalConfig {
	return &EnvLocalConfig{
		ApplicationAccountID: formStr(r, "envlocal.application_account_id", a.envLocal.ApplicationAccountID),
		TerraformAccountID:   formStr(r, "envlocal.terraform_account_id", a.envLocal.TerraformAccountID),
		ManagementAccountID:  formStr(r, "envlocal.management_account_id", a.envLocal.ManagementAccountID),
		ProfilePrefix:        formStr(r, "envlocal.profile_prefix", a.envLocal.ProfilePrefix),
		GitHubOrg:            formStr(r, "envlocal.github_org", a.envLocal.GitHubOrg),
		FwdEmailToAddress:    formStr(r, "envlocal.fwd_email_to_address", a.envLocal.FwdEmailToAddress),
		SOPSKMSKeyID:         formStr(r, "envlocal.sops_kms_key_id", a.envLocal.SOPSKMSKeyID),
		SSOStartURL:          formStr(r, "envlocal.sso_start_url", a.envLocal.SSOStartURL),
		SSOSessionName:       formStr(r, "envlocal.sso_session_name", a.envLocal.SSOSessionName),
	}
}

func parseServiceForm(r *http.Request, cfg *SiteConfig) {
	// Auth
	cfg.Services.Auth.Task.TaskCPU = formInt(r, "svc.auth.task_cpu", 512)
	cfg.Services.Auth.Task.TaskMemory = formInt(r, "svc.auth.task_memory", 1024)
	cfg.Services.Auth.Nginx.CPU = formInt(r, "svc.auth.nginx.cpu", 256)
	cfg.Services.Auth.Nginx.Memory = formInt(r, "svc.auth.nginx.memory", 512)
	cfg.Services.Auth.Nginx.MemoryReservation = formInt(r, "svc.auth.nginx.mem_reservation", 256)
	cfg.Services.Auth.App.CPU = formInt(r, "svc.auth.app.cpu", 256)
	cfg.Services.Auth.App.Memory = formInt(r, "svc.auth.app.memory", 512)
	cfg.Services.Auth.App.MemoryReservation = formInt(r, "svc.auth.app.mem_reservation", 256)
	cfg.Services.Auth.Service.DesiredCount = formInt(r, "svc.auth.desired_count", 1)
	cfg.Services.Auth.Service.Autoscaling.Enabled = formBool(r, "svc.auth.autoscaling.enabled")
	cfg.Services.Auth.Service.Autoscaling.MinCapacity = formInt(r, "svc.auth.autoscaling.min", 1)
	cfg.Services.Auth.Service.Autoscaling.MaxCapacity = formInt(r, "svc.auth.autoscaling.max", 2)

	// Human
	cfg.Services.Human.Task.TaskCPU = formInt(r, "svc.human.task_cpu", 512)
	cfg.Services.Human.Task.TaskMemory = formInt(r, "svc.human.task_memory", 1024)
	cfg.Services.Human.Nginx.CPU = formInt(r, "svc.human.nginx.cpu", 256)
	cfg.Services.Human.Nginx.Memory = formInt(r, "svc.human.nginx.memory", 512)
	cfg.Services.Human.Nginx.MemoryReservation = formInt(r, "svc.human.nginx.mem_reservation", 256)
	cfg.Services.Human.App.CPU = formInt(r, "svc.human.app.cpu", 256)
	cfg.Services.Human.App.Memory = formInt(r, "svc.human.app.memory", 512)
	cfg.Services.Human.App.MemoryReservation = formInt(r, "svc.human.app.mem_reservation", 256)
	cfg.Services.Human.Uploads.UploadsExpireDays = formInt(r, "svc.human.uploads_expire_days", 7)
	cfg.Services.Human.OnUploadLambda.Timeout = formInt(r, "svc.human.on_upload.timeout", 30)
	cfg.Services.Human.OnUploadLambda.MemorySize = formInt(r, "svc.human.on_upload.memory", 256)
	cfg.Services.Human.OnProcessLambda.Timeout = formInt(r, "svc.human.on_process.timeout", 300)
	cfg.Services.Human.OnProcessLambda.MemorySize = formInt(r, "svc.human.on_process.memory", 1024)
	cfg.Services.Human.Service.DesiredCount = formInt(r, "svc.human.desired_count", 1)
	cfg.Services.Human.Service.Autoscaling.Enabled = formBool(r, "svc.human.autoscaling.enabled")
	cfg.Services.Human.Service.Autoscaling.MinCapacity = formInt(r, "svc.human.autoscaling.min", 1)
	cfg.Services.Human.Service.Autoscaling.MaxCapacity = formInt(r, "svc.human.autoscaling.max", 2)

	// CMS
	cfg.Services.CMS.MasterTask.TaskCPU = formInt(r, "svc.cms.master.task_cpu", 512)
	cfg.Services.CMS.MasterTask.TaskMemory = formInt(r, "svc.cms.master.task_memory", 1024)
	cfg.Services.CMS.MasterNginx.CPU = formInt(r, "svc.cms.master.nginx.cpu", 128)
	cfg.Services.CMS.MasterNginx.Memory = formInt(r, "svc.cms.master.nginx.memory", 256)
	cfg.Services.CMS.MasterApp.CPU = formInt(r, "svc.cms.master.app.cpu", 384)
	cfg.Services.CMS.MasterApp.Memory = formInt(r, "svc.cms.master.app.memory", 768)
	cfg.Services.CMS.MasterApp.MemoryReservation = formInt(r, "svc.cms.master.app.mem_reservation", 512)
	cfg.Services.CMS.WorkerTask.TaskCPU = formInt(r, "svc.cms.worker.task_cpu", 512)
	cfg.Services.CMS.WorkerTask.TaskMemory = formInt(r, "svc.cms.worker.task_memory", 1024)
	cfg.Services.CMS.WorkerNginx.CPU = formInt(r, "svc.cms.worker.nginx.cpu", 128)
	cfg.Services.CMS.WorkerNginx.Memory = formInt(r, "svc.cms.worker.nginx.memory", 256)
	cfg.Services.CMS.WorkerApp.CPU = formInt(r, "svc.cms.worker.app.cpu", 384)
	cfg.Services.CMS.WorkerApp.Memory = formInt(r, "svc.cms.worker.app.memory", 768)
	cfg.Services.CMS.WorkerApp.MemoryReservation = formInt(r, "svc.cms.worker.app.mem_reservation", 512)
	cfg.Services.CMS.MasterService.DesiredCount = formInt(r, "svc.cms.master.desired_count", 1)
	cfg.Services.CMS.WorkerService.DesiredCount = formInt(r, "svc.cms.worker.desired_count", 1)
	cfg.Services.CMS.WorkerService.Autoscaling.Enabled = formBool(r, "svc.cms.worker.autoscaling.enabled")
	cfg.Services.CMS.WorkerService.Autoscaling.MinCapacity = formInt(r, "svc.cms.worker.autoscaling.min", 1)
	cfg.Services.CMS.WorkerService.Autoscaling.MaxCapacity = formInt(r, "svc.cms.worker.autoscaling.max", 3)

	// GPX
	cfg.Services.GPX.Task.TaskCPU = formInt(r, "svc.gpx.task_cpu", 256)
	cfg.Services.GPX.Task.TaskMemory = formInt(r, "svc.gpx.task_memory", 512)
	cfg.Services.GPX.App.CPU = formInt(r, "svc.gpx.app.cpu", 256)
	cfg.Services.GPX.App.Memory = formInt(r, "svc.gpx.app.memory", 512)
	cfg.Services.GPX.App.MemoryReservation = formInt(r, "svc.gpx.app.mem_reservation", 256)
	cfg.Services.GPX.Service.DesiredCount = formInt(r, "svc.gpx.desired_count", 1)
	cfg.Services.GPX.Service.Autoscaling.Enabled = formBool(r, "svc.gpx.autoscaling.enabled")
	cfg.Services.GPX.Service.Autoscaling.MinCapacity = formInt(r, "svc.gpx.autoscaling.min", 1)
	cfg.Services.GPX.Service.Autoscaling.MaxCapacity = formInt(r, "svc.gpx.autoscaling.max", 2)
}

// Form value helpers

func formStr(r *http.Request, key, fallback string) string {
	if v := r.FormValue(key); v != "" {
		return v
	}
	return fallback
}

func formInt(r *http.Request, key string, fallback int) int {
	if v := r.FormValue(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func formFloat(r *http.Request, key string, fallback float64) float64 {
	if v := r.FormValue(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func formBool(r *http.Request, key string) bool {
	return r.Form.Has(key)
}

func formCSV(r *http.Request, key string) []string {
	v := r.FormValue(key)
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func formRegions(r *http.Request, prefix string) []RegionRef {
	var regions []RegionRef
	allRegions := AllRegions()
	for _, reg := range allRegions {
		if r.Form.Has(prefix + "." + reg.Label) {
			regions = append(regions, reg)
		}
	}
	if len(regions) == 0 {
		return allRegions
	}
	return regions
}
