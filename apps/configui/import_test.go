package main

import (
	"path/filepath"
	"testing"
)

func TestImportSiteHCL(t *testing.T) {
	// Use the actual site.hcl from the repo
	repoRoot := "../.."
	siteHCLPath := filepath.Join(repoRoot, "infra", "terraform", "live", "site", "site.hcl")

	cfg, err := importSiteHCL(siteHCLPath)
	if err != nil {
		t.Fatalf("importSiteHCL failed: %v", err)
	}

	// Site identity
	assertEqual(t, "Site.Label", cfg.Site.Label, "dc34")
	assertEqual(t, "Site.GitHubRepoName", cfg.Site.GitHubRepoName, "defcon.run.34")
	assertEqual(t, "Site.TFStatePrefix", cfg.Site.TFStatePrefix, "tf-dc34")
	assertEqual(t, "Site.RandomSuffix", cfg.Site.RandomSuffix, "80a6b349")
	assertSliceEqual(t, "Site.SkipRegions", cfg.Site.SkipRegions, []string{"ap-southeast-1", "ca-central-1"})

	// DNS
	assertEqual(t, "DNS.ZoneName", cfg.DNS.ZoneName, "defcon.run")
	assertSliceEqual(t, "DNS.Subdomains", cfg.DNS.Subdomains, []string{"email", "run", "auth", "cms", "gpx", "flash"})
	assertIntEqual(t, "DNS.TTL", cfg.DNS.TTL, 300)

	// URLs
	assertEqual(t, "URLs.Subdomains[auth]", cfg.URLs.Subdomains["auth"], "auth")
	assertEqual(t, "URLs.Subdomains[run]", cfg.URLs.Subdomains["run"], "run")
	assertIntEqual(t, "URLs.LocalPorts[auth]", cfg.URLs.LocalPorts["auth"], 3002)
	assertIntEqual(t, "URLs.LocalPorts[run]", cfg.URLs.LocalPorts["run"], 3001)
	assertIntEqual(t, "URLs.LocalPorts[cms]", cfg.URLs.LocalPorts["cms"], 1337)

	// Email
	assertBoolEqual(t, "Email.Enabled", cfg.Email.Enabled, true)
	assertEqual(t, "Email.PrimaryRegion", cfg.Email.PrimaryRegion, "us-east-1")
	assertEqual(t, "Email.SMTPPrefix", cfg.Email.SMTPPrefix, "s")
	assertBoolEqual(t, "Email.MakeSiteDomain", cfg.Email.MakeSiteDomain, true)
	assertBoolEqual(t, "Email.MakeRegionalDomains", cfg.Email.MakeRegionalDomains, true)
	assertBoolEqual(t, "Email.MakeDomains", cfg.Email.MakeDomains, true)
	assertSliceEqual(t, "Email.ZoneSubdomains", cfg.Email.ZoneSubdomains, []string{"email", "run", "auth"})
	assertSliceEqual(t, "Email.SMTPIAMSubdomains", cfg.Email.SMTPIAMSubdomains, []string{"run", "auth", "cms"})
	assertIntEqual(t, "Email.ReplicaRegions len", len(cfg.Email.ReplicaRegions), 3)

	// WAF
	assertBoolEqual(t, "WAF.Enabled", cfg.WAF.Enabled, false)
	assertEqual(t, "WAF.LogMode", cfg.WAF.LogMode, "standard")

	// CloudFront
	assertBoolEqual(t, "CloudFront.Enabled", cfg.CloudFront.Enabled, true)
	assertSliceEqual(t, "CloudFront.Domains", cfg.CloudFront.Domains, []string{"auth", "run", "cms", "gpx", "flash"})
	assertEqual(t, "CloudFront.WAFRulesets[auth]", cfg.CloudFront.WAFRulesets["auth"], "auth")
	assertIntEqual(t, "CloudFront.Regions len", len(cfg.CloudFront.Regions), 3)
	assertBoolEqual(t, "CloudFront.Logging.Enabled", cfg.CloudFront.Logging.Enabled, true)
	assertBoolEqual(t, "CloudFront.Logging.IncludeCookies", cfg.CloudFront.Logging.IncludeCookies, false)
	assertEqual(t, "CloudFront.PriceClass", cfg.CloudFront.PriceClass, "PriceClass_100")

	// EC2 Spots
	assertBoolEqual(t, "EC2Spots.Enabled", cfg.EC2Spots.Enabled, false)
	assertIntEqual(t, "EC2Spots.Count", cfg.EC2Spots.Count, 0)
	assertEqual(t, "EC2Spots.InstanceType", cfg.EC2Spots.InstanceType, "t4g.medium")
	assertBoolEqual(t, "EC2Spots.CreateDNSRecords", cfg.EC2Spots.CreateDNSRecords, true)

	// ECS Clusters
	assertBoolEqual(t, "ECSClusters.Enabled", cfg.ECSClusters.Enabled, true)
	assertIntEqual(t, "ECSClusters.Clusters len", len(cfg.ECSClusters.Clusters), 1)
	assertEqual(t, "ECSClusters.Clusters[0].Name", cfg.ECSClusters.Clusters[0].Name, "app")
	assertEqual(t, "ECSClusters.Clusters[0].ClusterType", cfg.ECSClusters.Clusters[0].ClusterType, "FARGATE")

	// Toggle modules
	assertBoolEqual(t, "DynamoDB.Enabled", cfg.DynamoDB.Enabled, true)
	assertBoolEqual(t, "ECR.Enabled", cfg.ECR.Enabled, true)
	assertBoolEqual(t, "ECSTasks.Enabled", cfg.ECSTasks.Enabled, true)
	assertBoolEqual(t, "ECSServices.Enabled", cfg.ECSServices.Enabled, true)
	assertBoolEqual(t, "UserUploads.Enabled", cfg.UserUploads.Enabled, true)
	assertBoolEqual(t, "UploadProcessors.Enabled", cfg.UploadProcessors.Enabled, true)

	// Secrets
	assertBoolEqual(t, "Secrets.Enabled", cfg.Secrets.Enabled, true)
	assertBoolEqual(t, "Secrets.UseSecretsManager", cfg.Secrets.UseSecretsManager, false)
	assertEqual(t, "Secrets.PrimaryRegion", cfg.Secrets.PrimaryRegion, "us-east-1")
	assertEqual(t, "Secrets.SSMPrefix", cfg.Secrets.SSMPrefix, "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}")
	assertEqual(t, "Secrets.SMPrefix", cfg.Secrets.SMPrefix, "/{{SITE_LABEL}}/secrets")
	assertIntEqual(t, "Secrets.ReplicaRegions len", len(cfg.Secrets.ReplicaRegions), 2)

	// Secret definitions
	if _, ok := cfg.Secrets.Definitions["strava"]; !ok {
		t.Errorf("Missing secret definition: strava")
	}
	if _, ok := cfg.Secrets.Definitions["mapbox"]; !ok {
		t.Errorf("Missing secret definition: mapbox")
	} else {
		assertBoolEqual(t, "Secrets.Definitions[mapbox].Global", cfg.Secrets.Definitions["mapbox"].Global, true)
	}
	assertIntEqual(t, "Secrets.Definitions count", len(cfg.Secrets.Definitions), 12)

	// CloudTrail
	assertBoolEqual(t, "CloudTrail.Enabled", cfg.CloudTrail.Enabled, false)
	assertBoolEqual(t, "CloudTrail.MultiRegion", cfg.CloudTrail.MultiRegion, true)
	assertIntEqual(t, "CloudTrail.LogRetentionDays", cfg.CloudTrail.LogRetentionDays, 90)
	assertIntEqual(t, "CloudTrail.GlacierTransitionDays", cfg.CloudTrail.GlacierTransitionDays, 0)
	assertBoolEqual(t, "CloudTrail.EnableAccessAnalyzer", cfg.CloudTrail.EnableAccessAnalyzer, true)
	assertBoolEqual(t, "CloudTrail.EnableAthena", cfg.CloudTrail.EnableAthena, true)
	assertBoolEqual(t, "CloudTrail.EnableKMSEncryption", cfg.CloudTrail.EnableKMSEncryption, true)
	assertBoolEqual(t, "CloudTrail.EnableAlerts", cfg.CloudTrail.EnableAlerts, true)
	assertEqual(t, "CloudTrail.AlertEmail", cfg.CloudTrail.AlertEmail, "admin@example.com")
	assertSliceEqual(t, "CloudTrail.MonitorRoles", cfg.CloudTrail.MonitorRoles, []string{"terragrunt", "application", "readonly", "prowler", "e2e", "release", "deploy"})

	// GitHub OIDC
	assertBoolEqual(t, "GitHubOIDC.Enabled", cfg.GitHubOIDC.Enabled, true)
	assertBoolEqual(t, "GitHubOIDC.EC2RunnerProfile.Enabled", cfg.GitHubOIDC.EC2RunnerProfile.Enabled, true)
	assertEqual(t, "GitHubOIDC.EC2RunnerProfile.Name", cfg.GitHubOIDC.EC2RunnerProfile.Name, "github-runner")
}

func TestImportServiceHCL(t *testing.T) {
	repoRoot := "../.."
	servicesDir := filepath.Join(repoRoot, "infra", "terraform", "live", "site", "services")
	cfg := DefaultConfig()

	// Import all services
	for _, svc := range []string{"run.auth", "run.human", "run.cms", "run.gpx", "run.flash"} {
		svcPath := filepath.Join(servicesDir, svc, "service.hcl")
		if err := importServiceHCL(svcPath, svc, cfg); err != nil {
			t.Fatalf("importServiceHCL(%s) failed: %v", svc, err)
		}
	}

	// Auth service
	assertIntEqual(t, "Auth.Task.TaskCPU", cfg.Services.Auth.Task.TaskCPU, 512)
	assertIntEqual(t, "Auth.Task.TaskMemory", cfg.Services.Auth.Task.TaskMemory, 1024)
	assertIntEqual(t, "Auth.Nginx.CPU", cfg.Services.Auth.Nginx.CPU, 256)
	assertIntEqual(t, "Auth.Nginx.Memory", cfg.Services.Auth.Nginx.Memory, 512)
	assertIntEqual(t, "Auth.Nginx.HealthCheck.Interval", cfg.Services.Auth.Nginx.HealthCheck.Interval, 60)
	assertIntEqual(t, "Auth.App.CPU", cfg.Services.Auth.App.CPU, 256)
	assertIntEqual(t, "Auth.App.HealthCheck.Interval", cfg.Services.Auth.App.HealthCheck.Interval, 30)
	assertIntEqual(t, "Auth.App.HealthCheck.StartPeriod", cfg.Services.Auth.App.HealthCheck.StartPeriod, 120)
	assertIntEqual(t, "Auth.DynamoDB count", len(cfg.Services.Auth.DynamoDB), 3)
	assertEqual(t, "Auth.DynamoDB[0].TableName", cfg.Services.Auth.DynamoDB[0].TableName, "run-auth-electro")
	assertEqual(t, "Auth.DynamoDB[1].TableName", cfg.Services.Auth.DynamoDB[1].TableName, "run-auth-authjs")
	assertBoolEqual(t, "Auth.DynamoDB[1].TTLEnabled", cfg.Services.Auth.DynamoDB[1].TTLEnabled, true)
	assertEqual(t, "Auth.DynamoDB[1].TTLAttribute", cfg.Services.Auth.DynamoDB[1].TTLAttribute, "ttl")
	assertIntEqual(t, "Auth.Service.DesiredCount", cfg.Services.Auth.Service.DesiredCount, 1)
	assertEqual(t, "Auth.Service.HealthCheckPath", cfg.Services.Auth.Service.HealthCheckPath, "/hello")
	assertEqual(t, "Auth.Service.Matcher", cfg.Services.Auth.Service.Matcher, "200-499")
	assertBoolEqual(t, "Auth.Service.Autoscaling.Enabled", cfg.Services.Auth.Service.Autoscaling.Enabled, false)

	// Human service
	assertIntEqual(t, "Human.Task.TaskCPU", cfg.Services.Human.Task.TaskCPU, 512)
	assertIntEqual(t, "Human.Uploads.UploadsExpireDays", cfg.Services.Human.Uploads.UploadsExpireDays, 7)
	assertBoolEqual(t, "Human.Uploads.Versioning", cfg.Services.Human.Uploads.Versioning, true)
	assertBoolEqual(t, "Human.Uploads.ReplicationEnabled", cfg.Services.Human.Uploads.ReplicationEnabled, true)
	assertIntEqual(t, "Human.OnUploadLambda.Timeout", cfg.Services.Human.OnUploadLambda.Timeout, 30)
	assertIntEqual(t, "Human.OnUploadLambda.MemorySize", cfg.Services.Human.OnUploadLambda.MemorySize, 256)
	assertIntEqual(t, "Human.OnProcessLambda.Timeout", cfg.Services.Human.OnProcessLambda.Timeout, 300)
	assertIntEqual(t, "Human.OnProcessLambda.MemorySize", cfg.Services.Human.OnProcessLambda.MemorySize, 1024)

	// CMS service
	assertIntEqual(t, "CMS.MasterTask.TaskCPU", cfg.Services.CMS.MasterTask.TaskCPU, 512)
	assertSliceEqual(t, "CMS.MasterTask.Regions", cfg.Services.CMS.MasterTask.Regions, []string{"us-east-1"})
	assertIntEqual(t, "CMS.MasterNginx.CPU", cfg.Services.CMS.MasterNginx.CPU, 128)
	assertIntEqual(t, "CMS.MasterApp.CPU", cfg.Services.CMS.MasterApp.CPU, 384)
	assertIntEqual(t, "CMS.MasterApp.Memory", cfg.Services.CMS.MasterApp.Memory, 768)
	assertIntEqual(t, "CMS.MasterApp.MemoryReservation", cfg.Services.CMS.MasterApp.MemoryReservation, 512)
	assertIntEqual(t, "CMS.MasterApp.HealthCheck.StartPeriod", cfg.Services.CMS.MasterApp.HealthCheck.StartPeriod, 180)
	assertIntEqual(t, "CMS.WorkerTask.TaskCPU", cfg.Services.CMS.WorkerTask.TaskCPU, 512)
	assertBoolEqual(t, "CMS.Litestream.FullBucketAccess", cfg.Services.CMS.Litestream.FullBucketAccess, true)
	assertBoolEqual(t, "CMS.Media.CloudFrontAccess", cfg.Services.CMS.Media.CloudFrontAccess, true)
	assertBoolEqual(t, "CMS.Media.ReplicationEnabled", cfg.Services.CMS.Media.ReplicationEnabled, true)
	assertIntEqual(t, "CMS.MasterService.Priority", cfg.Services.CMS.MasterService.Priority, 100)
	assertBoolEqual(t, "CMS.WorkerService.Autoscaling.Enabled", cfg.Services.CMS.WorkerService.Autoscaling.Enabled, true)
	assertIntEqual(t, "CMS.WorkerService.Autoscaling.MaxCapacity", cfg.Services.CMS.WorkerService.Autoscaling.MaxCapacity, 3)

	// GPX service
	assertIntEqual(t, "GPX.Task.TaskCPU", cfg.Services.GPX.Task.TaskCPU, 256)
	assertIntEqual(t, "GPX.Task.TaskMemory", cfg.Services.GPX.Task.TaskMemory, 512)
	assertIntEqual(t, "GPX.App.CPU", cfg.Services.GPX.App.CPU, 256)
	assertIntEqual(t, "GPX.DynamoDB count", len(cfg.Services.GPX.DynamoDB), 1)
	assertEqual(t, "GPX.DynamoDB[0].TableName", cfg.Services.GPX.DynamoDB[0].TableName, "run-gpx-electro")
	assertBoolEqual(t, "GPX.Storage.Versioning", cfg.Services.GPX.Storage.Versioning, true)
	assertBoolEqual(t, "GPX.Storage.ReplicationEnabled", cfg.Services.GPX.Storage.ReplicationEnabled, true)
	assertIntEqual(t, "GPX.Service.DesiredCount", cfg.Services.GPX.Service.DesiredCount, 1)
	assertEqual(t, "GPX.Service.Matcher", cfg.Services.GPX.Service.Matcher, "200")
}

// --- Test helpers ---

func assertEqual(t *testing.T, name, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %q, want %q", name, got, want)
	}
}

func assertIntEqual(t *testing.T, name string, got, want int) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %d, want %d", name, got, want)
	}
}

func assertBoolEqual(t *testing.T, name string, got, want bool) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", name, got, want)
	}
}

func assertSliceEqual(t *testing.T, name string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s length = %d, want %d (got %v)", name, len(got), len(want), got)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s[%d] = %q, want %q", name, i, got[i], want[i])
		}
	}
}
