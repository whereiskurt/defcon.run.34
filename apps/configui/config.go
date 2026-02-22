package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// RegionRef identifies an AWS region with a short label and full name.
type RegionRef struct {
	Label string `json:"label"`
	Full  string `json:"full"`
}

// SiteConfig is the top-level configuration that maps to site.hcl + service.hcl values.
type SiteConfig struct {
	Site             SiteIdentity       `json:"site"`
	DNS              DNSConfig          `json:"dns"`
	URLs             URLsConfig         `json:"urls"`
	Env              EnvConfig          `json:"env"`
	Email            EmailConfig        `json:"email"`
	WAF              WAFConfig          `json:"waf"`
	CloudFront       CloudFrontConfig   `json:"cloudfront"`
	EC2Spots         EC2SpotsConfig     `json:"ec2spots"`
	ECSClusters      ECSClustersConfig  `json:"ecs_clusters"`
	DynamoDB         ModuleToggle       `json:"dynamodb"`
	ECR              ModuleToggle       `json:"ecr"`
	ECSTasks         ModuleToggle       `json:"ecs_tasks"`
	ECSServices      ModuleToggle       `json:"ecs_services"`
	UserUploads      ModuleToggle       `json:"user_uploads"`
	UploadProcessors ModuleToggle       `json:"upload_processors"`
	Secrets          SecretsConfig      `json:"secrets"`
	CloudTrail       CloudTrailConfig   `json:"cloudtrail"`
	GitHubOIDC       GitHubOIDCConfig   `json:"github_oidc"`
	Services         ServiceConfigs     `json:"services"`
	Waffaw           WaffawConfig       `json:"waffaw"`
	Versions         VersionConfig      `json:"versions"`
}

type WaffawConfig struct {
	Enabled         bool   `json:"enabled"`
	EC2Count        int    `json:"ec2_count"`
	EC2MaxCount     int    `json:"ec2_max_count"`
	EC2InstanceType string `json:"ec2_instance_type"`
	EC2UseSpot      bool   `json:"ec2_use_spot"`
	EC2MultiENI     bool   `json:"ec2_multi_eni"`
	ECSDesiredCount int    `json:"ecs_desired_count"`
	ECSUseSpot      bool   `json:"ecs_use_spot"`
	ECSTaskCPU      int    `json:"ecs_task_cpu"`
	ECSTaskMemory   int    `json:"ecs_task_memory"`
	ImageURI        string `json:"image_uri"`
	UserAgent       string `json:"user_agent,omitempty"`
	CustomHeaderKey string `json:"custom_header_key,omitempty"`
	CustomHeaderVal string `json:"custom_header_value,omitempty"`
}

type SiteIdentity struct {
	Label          string   `json:"label"`
	GitHubRepoName string   `json:"github_repo_name"`
	TFStatePrefix  string   `json:"tf_state_prefix"`
	RandomSuffix   string   `json:"random_suffix"`
	SkipRegions    []string `json:"skip_regions"`
}

type DNSConfig struct {
	ZoneName   string   `json:"zonename"`
	Subdomains []string `json:"subdomains"`
	TTL        int      `json:"ttl"`
}

type URLsConfig struct {
	Subdomains map[string]string `json:"subdomains"`
	LocalPorts map[string]int    `json:"local_ports"`
}

type EnvConfig struct {
	SiteDomain  string `json:"site_domain"`
	SiteLabel   string `json:"site_label"`
	AWSRegion   string `json:"aws_region"`
	RegionShort string `json:"region_short"`
	LocalPorts  struct {
		Run  int `json:"run"`
		Auth int `json:"auth"`
		GPX  int `json:"gpx"`
		CMS  int `json:"cms"`
	} `json:"local_ports"`
}

// EnvLocalConfig holds sensitive values (not stored in JSON sidecar).
type EnvLocalConfig struct {
	ApplicationAccountID string `json:"application_account_id"`
	TerraformAccountID   string `json:"terraform_account_id"`
	ManagementAccountID  string `json:"management_account_id"`
	ProfilePrefix        string `json:"profile_prefix"`
	GitHubOrg            string `json:"github_org"`
	FwdEmailToAddress    string `json:"fwd_email_to_address"`
	SOPSKMSKeyID         string `json:"sops_kms_key_id"`
	SSOStartURL          string `json:"sso_start_url"`
	SSOSessionName       string `json:"sso_session_name"`
}

// FwdRule represents an email forwarding rule.
// Match stores the local-part (and optional subdomain) before @${local.dns.zonename}:
//   - "admin" → renders as "admin@${local.dns.zonename}"
//   - "no-reply@run" → renders as "no-reply@run.${local.dns.zonename}"
type FwdRule struct {
	Match         string `json:"match"`
	SendToDefault string `json:"send_to_default"`
}

type EmailConfig struct {
	Enabled             bool        `json:"enabled"`
	PrimaryRegion       string      `json:"primary_region"`
	SMTPPrefix          string      `json:"smtp_prefix"`
	MakeSiteDomain      bool        `json:"make_site_domain"`
	MakeRegionalDomains bool        `json:"make_regional_domains"`
	MakeDomains         bool        `json:"make_domains"`
	ZoneSubdomains      []string    `json:"zone_subdomains"`
	SMTPIAMSubdomains   []string    `json:"smtp_iam_subdomains"`
	ReplicaRegions      []RegionRef `json:"replica_regions"`
	FwdRules            []FwdRule   `json:"fwd_rules"`
	CatchAllEnabled     bool        `json:"catch_all_enabled"`
}

type WAFConfig struct {
	Enabled bool   `json:"enabled"`
	LogMode string `json:"log_mode"`
}

type CloudFrontConfig struct {
	Enabled     bool              `json:"enabled"`
	Domains     []string          `json:"domains"`
	WAFRulesets map[string]string `json:"waf_rulesets"`
	Regions     []RegionRef       `json:"regions"`
	Logging     struct {
		Enabled        bool `json:"enabled"`
		IncludeCookies bool `json:"include_cookies"`
	} `json:"logging"`
	PriceClass string `json:"price_class"`
}

type EC2SpotsConfig struct {
	Enabled            bool     `json:"enabled"`
	Count              int      `json:"count"`
	Regions            []string `json:"regions"`
	InstanceType       string   `json:"instance_type"`
	CreateDNSRecords   bool     `json:"create_dns_records"`
	SpotPriceMultiplier float64 `json:"spot_price_multiplier"`
	SpotPriceOffset     float64 `json:"spot_price_offset"`
	BlockDurationMin    int     `json:"block_duration_minutes"`
	EC2KeyNamePrefix    string  `json:"ec2key_name_prefix"`
}

type ECSClustersConfig struct {
	Enabled  bool         `json:"enabled"`
	Clusters []ECSCluster `json:"clusters"`
}

type ECSCluster struct {
	Name           string   `json:"name"`
	Regions        []string `json:"regions"`
	EnableInsights bool     `json:"enable_insights"`
	ClusterType    string   `json:"cluster_type"`
}

type ModuleToggle struct {
	Enabled bool `json:"enabled"`
}

type SecretsConfig struct {
	Enabled           bool                          `json:"enabled"`
	UseSecretsManager bool                          `json:"use_secrets_manager"`
	PrimaryRegion     string                        `json:"primary_region"`
	ReplicaRegions    []RegionRef                   `json:"replica_regions"`
	SSMPrefix         string                        `json:"ssm_prefix"`
	SMPrefix          string                        `json:"sm_prefix"`
	Definitions       map[string]SecretDefinition   `json:"definitions"`
}

type SecretDefinition struct {
	Description string   `json:"description"`
	Keys        []string `json:"keys"`
	Global      bool     `json:"global,omitempty"`
}

type CloudTrailConfig struct {
	Enabled               bool     `json:"enabled"`
	MultiRegion           bool     `json:"multi_region"`
	LogRetentionDays      int      `json:"log_retention_days"`
	GlacierTransitionDays int      `json:"glacier_transition_days"`
	EnableAccessAnalyzer  bool     `json:"enable_access_analyzer"`
	EnableAthena          bool     `json:"enable_athena"`
	EnableKMSEncryption   bool     `json:"enable_kms_encryption"`
	EnableAlerts          bool     `json:"enable_alerts"`
	AlertEmail            string   `json:"alert_email"`
	MonitorRoles          []string `json:"monitor_roles"`
}

type GitHubOIDCConfig struct {
	Enabled          bool   `json:"enabled"`
	DelegateRoleName string `json:"delegate_role_name"`
	EC2RunnerProfile struct {
		Enabled bool   `json:"enabled"`
		Name    string `json:"name"`
	} `json:"ec2_runner_instance_profile"`
	Roles []GitHubOIDCRole `json:"roles"`
}

type GitHubOIDCRole struct {
	Name                   string `json:"name"`
	Description            string `json:"description"`
	BranchRestriction      string `json:"branch_restriction,omitempty"`
	EnvironmentRestriction string `json:"environment_restriction,omitempty"`
	MaxSessionDuration     int    `json:"max_session_duration"`
}

// Service configs

type ServiceConfigs struct {
	Auth  AuthServiceConfig  `json:"auth"`
	Human HumanServiceConfig `json:"human"`
	CMS   CMSServiceConfig   `json:"cms"`
	GPX   GPXServiceConfig   `json:"gpx"`
}

type ContainerConfig struct {
	CPU               int               `json:"cpu"`
	Memory            int               `json:"memory"`
	MemoryReservation int               `json:"memory_reservation"`
	HealthCheck       HealthCheckConfig `json:"health_check"`
}

type HealthCheckConfig struct {
	Interval    int `json:"interval"`
	Timeout     int `json:"timeout"`
	Retries     int `json:"retries"`
	StartPeriod int `json:"start_period"`
}

type TaskConfig struct {
	TaskCPU    int      `json:"task_cpu"`
	TaskMemory int      `json:"task_memory"`
	Regions    []string `json:"regions"`
}

type ServiceRunConfig struct {
	DesiredCount    int               `json:"desired_count"`
	HealthCheckPath string            `json:"health_check_path"`
	Matcher         string            `json:"matcher"`
	Priority        int               `json:"priority,omitempty"`
	Autoscaling     AutoscalingConfig `json:"autoscaling"`
}

type AutoscalingConfig struct {
	Enabled     bool `json:"enabled"`
	MinCapacity int  `json:"min_capacity"`
	MaxCapacity int  `json:"max_capacity"`
	CPUScaleOut int  `json:"cpu_scale_out"`
	CPUScaleIn  int  `json:"cpu_scale_in"`
	Cooldown    int  `json:"cooldown"`
}

type DynamoDBTableConfig struct {
	TableName      string      `json:"table_name"`
	TableType      string      `json:"table_type"`
	TTLEnabled     bool        `json:"ttl_enabled"`
	TTLAttribute   string      `json:"ttl_attribute"`
	ReplicaRegions []RegionRef `json:"replica_regions"`
}

type S3BucketConfig struct {
	UploadsExpireDays  int         `json:"uploads_expire_days"`
	Versioning         bool        `json:"versioning"`
	ReplicationEnabled bool        `json:"replication_enabled"`
	ReplicaRegions     []RegionRef `json:"replica_regions"`
	SSMReplicateTo     []RegionRef `json:"ssm_replicate_to"`
	FullBucketAccess   bool        `json:"full_bucket_access"`
	CloudFrontAccess   bool        `json:"cloudfront_access"`
}

type LambdaConfig struct {
	Timeout    int `json:"timeout"`
	MemorySize int `json:"memory_size"`
}

type AuthServiceConfig struct {
	Task     TaskConfig            `json:"task"`
	Nginx    ContainerConfig       `json:"nginx"`
	App      ContainerConfig       `json:"app"`
	DynamoDB []DynamoDBTableConfig `json:"dynamodb_tables"`
	Service  ServiceRunConfig      `json:"service"`
}

type HumanServiceConfig struct {
	Task            TaskConfig            `json:"task"`
	Nginx           ContainerConfig       `json:"nginx"`
	App             ContainerConfig       `json:"app"`
	DynamoDB        []DynamoDBTableConfig `json:"dynamodb_tables"`
	Uploads         S3BucketConfig        `json:"uploads"`
	OnUploadLambda  LambdaConfig          `json:"on_upload_lambda"`
	OnProcessLambda LambdaConfig          `json:"on_process_lambda"`
	Service         ServiceRunConfig      `json:"service"`
}

type CMSServiceConfig struct {
	MasterTask    TaskConfig       `json:"master_task"`
	MasterNginx   ContainerConfig `json:"master_nginx"`
	MasterApp     ContainerConfig `json:"master_app"`
	WorkerTask    TaskConfig       `json:"worker_task"`
	WorkerNginx   ContainerConfig `json:"worker_nginx"`
	WorkerApp     ContainerConfig `json:"worker_app"`
	Litestream    S3BucketConfig  `json:"litestream"`
	Media         S3BucketConfig  `json:"media"`
	MasterService ServiceRunConfig `json:"master_service"`
	WorkerService ServiceRunConfig `json:"worker_service"`
}

type GPXServiceConfig struct {
	Task     TaskConfig            `json:"task"`
	App      ContainerConfig       `json:"app"`
	DynamoDB []DynamoDBTableConfig `json:"dynamodb_tables"`
	Storage  S3BucketConfig        `json:"storage"`
	Service  ServiceRunConfig      `json:"service"`
}

type VersionConfig struct {
	Auth  ComponentVersions `json:"auth"`
	Human ComponentVersions `json:"human"`
	CMS   ComponentVersions `json:"cms"`
	GPX   ComponentVersions `json:"gpx"`
}

type ComponentVersions struct {
	App   string `json:"app"`
	Nginx string `json:"nginx,omitempty"`
}

// AllRegions returns the standard three-region set.
func AllRegions() []RegionRef {
	return []RegionRef{
		{Label: "use1", Full: "us-east-1"},
		{Label: "cac1", Full: "ca-central-1"},
		{Label: "apse1", Full: "ap-southeast-1"},
	}
}

// AllRegionStrings returns full region names.
func AllRegionStrings() []string {
	return []string{"us-east-1", "ca-central-1", "ap-southeast-1"}
}

// DefaultConfig returns a SiteConfig initialized to match the current site.hcl defaults.
func DefaultConfig() *SiteConfig {
	allRegions := AllRegions()
	allRegionStrings := AllRegionStrings()

	return &SiteConfig{
		Site: SiteIdentity{
			Label:          "dc34",
			GitHubRepoName: "defcon.run.34",
			TFStatePrefix:  "tf-dc34",
			RandomSuffix:   "80a6b349",
			SkipRegions:    []string{},
		},
		DNS: DNSConfig{
			ZoneName:   "defcon.run",
			Subdomains: []string{"email", "run", "auth", "cms", "gpx"},
			TTL:        300,
		},
		URLs: URLsConfig{
			Subdomains: map[string]string{
				"auth": "auth",
				"run":  "run",
				"gpx":  "gpx",
				"cms":  "cms",
			},
			LocalPorts: map[string]int{
				"auth": 3002,
				"run":  3001,
				"gpx":  3003,
				"cms":  1337,
			},
		},
		Env: EnvConfig{
			SiteDomain:  "defcon.run",
			SiteLabel:   "dc34",
			AWSRegion:   "us-east-1",
			RegionShort: "use1",
			LocalPorts: struct {
				Run  int `json:"run"`
				Auth int `json:"auth"`
				GPX  int `json:"gpx"`
				CMS  int `json:"cms"`
			}{
				Run:  3001,
				Auth: 3002,
				GPX:  3003,
				CMS:  1337,
			},
		},
		Email: EmailConfig{
			Enabled:             true,
			PrimaryRegion:       "us-east-1",
			SMTPPrefix:          "s",
			MakeSiteDomain:      true,
			MakeRegionalDomains: true,
			MakeDomains:         true,
			ZoneSubdomains:      []string{"email", "run", "auth"},
			SMTPIAMSubdomains:   []string{"run", "auth", "cms"},
			ReplicaRegions:      allRegions,
			FwdRules: []FwdRule{
				{Match: "admin", SendToDefault: "admin@example.com"},
				{Match: "no-reply@run", SendToDefault: "no-reply@run.example.com"},
			},
			CatchAllEnabled: true,
		},
		WAF: WAFConfig{
			Enabled: true,
			LogMode: "standard",
		},
		CloudFront: CloudFrontConfig{
			Enabled:     true,
			Domains:     []string{"auth", "run", "cms", "gpx"},
			WAFRulesets: map[string]string{"auth": "auth"},
			Regions:     allRegions,
			Logging: struct {
				Enabled        bool `json:"enabled"`
				IncludeCookies bool `json:"include_cookies"`
			}{
				Enabled:        true,
				IncludeCookies: false,
			},
			PriceClass: "PriceClass_100",
		},
		EC2Spots: EC2SpotsConfig{
			Enabled:            false,
			Count:              0,
			Regions:            []string{"us-east-1", "ca-central-1", "ap-southeast-1"},
			InstanceType:       "t4g.medium",
			CreateDNSRecords:   true,
			SpotPriceMultiplier: 1.00,
			SpotPriceOffset:     0.0005,
			BlockDurationMin:    0,
			EC2KeyNamePrefix:    "ec2spot",
		},
		ECSClusters: ECSClustersConfig{
			Enabled: true,
			Clusters: []ECSCluster{
				{
					Name:           "app",
					Regions:        allRegionStrings,
					EnableInsights: true,
					ClusterType:    "FARGATE",
				},
			},
		},
		DynamoDB:         ModuleToggle{Enabled: true},
		ECR:              ModuleToggle{Enabled: true},
		ECSTasks:         ModuleToggle{Enabled: true},
		ECSServices:      ModuleToggle{Enabled: true},
		UserUploads:      ModuleToggle{Enabled: true},
		UploadProcessors: ModuleToggle{Enabled: true},
		Secrets: SecretsConfig{
			Enabled:           true,
			UseSecretsManager: false,
			PrimaryRegion:     "us-east-1",
			ReplicaRegions: []RegionRef{
				{Label: "cac1", Full: "ca-central-1"},
				{Label: "apse1", Full: "ap-southeast-1"},
			},
			SSMPrefix: "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}",
			SMPrefix:  "/{{SITE_LABEL}}/secrets",
			Definitions: map[string]SecretDefinition{
				"strava":        {Description: "Strava OAuth credentials", Keys: []string{"client_id", "client_secret"}},
				"github":        {Description: "GitHub OAuth credentials", Keys: []string{"client_id", "client_secret"}},
				"discord":       {Description: "Discord OAuth credentials", Keys: []string{"client_id", "client_secret"}},
				"jwt":           {Description: "JWT signing secrets", Keys: []string{"secret", "internal_secret"}},
				"oidc":          {Description: "OIDC cookie encryption keys", Keys: []string{"cookie_keys"}},
				"runhuman":      {Description: "RunHuman OIDC client credentials", Keys: []string{"client_id", "client_secret"}},
				"altcha":        {Description: "ALTCHA proof-of-work secret", Keys: []string{"secret"}},
				"origin_verify": {Description: "CloudFront origin verification secret", Keys: []string{"secret"}},
				"strapi":        {Description: "Strapi CMS secrets", Keys: []string{"admin_jwt_secret", "api_token_salt", "app_keys", "transfer_token_salt", "jwt_secret", "oidc_client_id", "oidc_client_secret"}},
				"gpxstudio":     {Description: "GPX Studio OIDC client credentials", Keys: []string{"client_id", "client_secret"}},
				"mapbox":        {Description: "Mapbox API tokens", Keys: []string{"public_token"}, Global: true},
			},
		},
		CloudTrail: CloudTrailConfig{
			Enabled:               true,
			MultiRegion:           true,
			LogRetentionDays:      90,
			GlacierTransitionDays: 0,
			EnableAccessAnalyzer:  true,
			EnableAthena:          true,
			EnableKMSEncryption:   true,
			EnableAlerts:          true,
			AlertEmail:            "",
			MonitorRoles:          []string{"terragrunt", "application", "readonly", "prowler", "e2e", "release", "deploy"},
		},
		GitHubOIDC: GitHubOIDCConfig{
			Enabled:          true,
			DelegateRoleName: "github-delegate",
			EC2RunnerProfile: struct {
				Enabled bool   `json:"enabled"`
				Name    string `json:"name"`
			}{
				Enabled: true,
				Name:    "github-runner",
			},
			Roles: []GitHubOIDCRole{
				{Name: "terragrunt", Description: "Terragrunt infrastructure deployments", EnvironmentRestriction: "terraform-apply", MaxSessionDuration: 3600},
				{Name: "application", Description: "Application deployments (ECR, S3, ECS)", BranchRestriction: "main", MaxSessionDuration: 3600},
				{Name: "readonly", Description: "Read-only for PR plan previews", MaxSessionDuration: 3600},
				{Name: "prowler", Description: "Prowler security scanning (read-only)", MaxSessionDuration: 3600},
				{Name: "e2e", Description: "E2E tests against production (S3 email access)", EnvironmentRestriction: "e2e-tests", MaxSessionDuration: 3600},
				{Name: "release", Description: "Release workflow (ECR push, S3 assets, CF invalidation)", MaxSessionDuration: 7200},
				{Name: "deploy", Description: "Deploy workflow (ECS updates via terragrunt)", BranchRestriction: "main", MaxSessionDuration: 3600},
			},
		},
		Services: ServiceConfigs{
			Auth: AuthServiceConfig{
				Task: TaskConfig{TaskCPU: 512, TaskMemory: 1024, Regions: allRegionStrings},
				Nginx: ContainerConfig{
					CPU: 256, Memory: 512, MemoryReservation: 256,
					HealthCheck: HealthCheckConfig{Interval: 60, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				App: ContainerConfig{
					CPU: 256, Memory: 512, MemoryReservation: 256,
					HealthCheck: HealthCheckConfig{Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				DynamoDB: []DynamoDBTableConfig{
					{TableName: "run-auth-electro", TableType: "electro", TTLEnabled: false, ReplicaRegions: allRegions},
					{TableName: "run-auth-authjs", TableType: "nextauth", TTLEnabled: true, TTLAttribute: "ttl", ReplicaRegions: allRegions},
					{TableName: "run-quota-electro", TableType: "electro", TTLEnabled: false, ReplicaRegions: allRegions},
				},
				Service: ServiceRunConfig{
					DesiredCount: 1, HealthCheckPath: "/hello", Matcher: "200-499",
					Autoscaling: AutoscalingConfig{Enabled: false, MinCapacity: 1, MaxCapacity: 2, CPUScaleOut: 75, CPUScaleIn: 25, Cooldown: 120},
				},
			},
			Human: HumanServiceConfig{
				Task: TaskConfig{TaskCPU: 512, TaskMemory: 1024, Regions: allRegionStrings},
				Nginx: ContainerConfig{
					CPU: 256, Memory: 512, MemoryReservation: 256,
					HealthCheck: HealthCheckConfig{Interval: 60, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				App: ContainerConfig{
					CPU: 256, Memory: 512, MemoryReservation: 256,
					HealthCheck: HealthCheckConfig{Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				DynamoDB: []DynamoDBTableConfig{
					{TableName: "run-human-electro", TableType: "electro", TTLEnabled: false, ReplicaRegions: allRegions},
					{TableName: "run-human-authjs", TableType: "nextauth", TTLEnabled: true, TTLAttribute: "ttl", ReplicaRegions: allRegions},
				},
				Uploads: S3BucketConfig{
					UploadsExpireDays: 7, Versioning: true, ReplicationEnabled: true, ReplicaRegions: allRegions,
				},
				OnUploadLambda:  LambdaConfig{Timeout: 30, MemorySize: 256},
				OnProcessLambda: LambdaConfig{Timeout: 300, MemorySize: 1024},
				Service: ServiceRunConfig{
					DesiredCount: 1, HealthCheckPath: "/hello", Matcher: "200-499",
					Autoscaling: AutoscalingConfig{Enabled: false, MinCapacity: 1, MaxCapacity: 2, CPUScaleOut: 75, CPUScaleIn: 25, Cooldown: 120},
				},
			},
			CMS: CMSServiceConfig{
				MasterTask: TaskConfig{TaskCPU: 512, TaskMemory: 1024, Regions: []string{"us-east-1"}},
				MasterNginx: ContainerConfig{
					CPU: 128, Memory: 256, MemoryReservation: 128,
					HealthCheck: HealthCheckConfig{Interval: 60, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				MasterApp: ContainerConfig{
					CPU: 384, Memory: 768, MemoryReservation: 512,
					HealthCheck: HealthCheckConfig{Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 180},
				},
				WorkerTask: TaskConfig{TaskCPU: 512, TaskMemory: 1024, Regions: allRegionStrings},
				WorkerNginx: ContainerConfig{
					CPU: 128, Memory: 256, MemoryReservation: 128,
					HealthCheck: HealthCheckConfig{Interval: 60, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				WorkerApp: ContainerConfig{
					CPU: 384, Memory: 768, MemoryReservation: 512,
					HealthCheck: HealthCheckConfig{Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 180},
				},
				Litestream: S3BucketConfig{
					UploadsExpireDays: 0, Versioning: true, ReplicationEnabled: false, FullBucketAccess: true,
					ReplicaRegions: []RegionRef{{Label: "use1", Full: "us-east-1"}},
					SSMReplicateTo: []RegionRef{
						{Label: "cac1", Full: "ca-central-1"},
						{Label: "apse1", Full: "ap-southeast-1"},
					},
				},
				Media: S3BucketConfig{
					UploadsExpireDays: 0, Versioning: true, ReplicationEnabled: true, CloudFrontAccess: true,
					ReplicaRegions: allRegions,
				},
				MasterService: ServiceRunConfig{
					DesiredCount: 1, HealthCheckPath: "/hello", Matcher: "200-499", Priority: 100,
					Autoscaling: AutoscalingConfig{Enabled: false, MinCapacity: 1, MaxCapacity: 1, CPUScaleOut: 75, CPUScaleIn: 25, Cooldown: 120},
				},
				WorkerService: ServiceRunConfig{
					DesiredCount: 1, Matcher: "200-499",
					Autoscaling: AutoscalingConfig{Enabled: true, MinCapacity: 1, MaxCapacity: 3, CPUScaleOut: 75, CPUScaleIn: 25, Cooldown: 120},
				},
			},
			GPX: GPXServiceConfig{
				Task: TaskConfig{TaskCPU: 256, TaskMemory: 512, Regions: allRegionStrings},
				App: ContainerConfig{
					CPU: 256, Memory: 512, MemoryReservation: 256,
					HealthCheck: HealthCheckConfig{Interval: 30, Timeout: 5, Retries: 3, StartPeriod: 120},
				},
				DynamoDB: []DynamoDBTableConfig{
					{TableName: "run-gpx-electro", TableType: "electro", TTLEnabled: false, ReplicaRegions: allRegions},
				},
				Storage: S3BucketConfig{
					UploadsExpireDays: 0, Versioning: true, ReplicationEnabled: true,
					ReplicaRegions: allRegions,
				},
				Service: ServiceRunConfig{
					DesiredCount: 1, HealthCheckPath: "/api/health", Matcher: "200",
					Autoscaling: AutoscalingConfig{Enabled: false, MinCapacity: 1, MaxCapacity: 2, CPUScaleOut: 75, CPUScaleIn: 25, Cooldown: 120},
				},
			},
		},
		Waffaw: WaffawConfig{
			Enabled:         true,
			EC2Count:        1,
			EC2MaxCount:     10,
			EC2InstanceType: "t3.medium",
			EC2UseSpot:      true,
			EC2MultiENI:     false,
			ECSDesiredCount: 1,
			ECSUseSpot:      true,
			ECSTaskCPU:      1024,
			ECSTaskMemory:   2048,
			ImageURI:        "${local.site.label}-waffaw:1.0.7",
		},
		Versions: VersionConfig{
			Auth:  ComponentVersions{App: "v0.0.27", Nginx: "v0.0.27"},
			Human: ComponentVersions{App: "v0.0.27", Nginx: "v0.0.27"},
			CMS:   ComponentVersions{App: "v0.0.27", Nginx: "v0.0.27"},
			GPX:   ComponentVersions{App: "v0.0.27"},
		},
	}
}

// LoadConfig reads site-config.json from disk. Returns DefaultConfig if not found.
func LoadConfig(path string) (*SiteConfig, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// SaveConfig writes site-config.json to disk.
// DefaultFormValues returns a map of form field names to their default string values.
// Used by the UI to visually indicate which fields still hold default values.
func DefaultFormValues() map[string]string {
	d := DefaultConfig()
	return map[string]string{
		"site.label":            d.Site.Label,
		"site.github_repo_name": d.Site.GitHubRepoName,
		"site.tf_state_prefix":  d.Site.TFStatePrefix,
		"site.random_suffix":    d.Site.RandomSuffix,
		"dns.zonename":          d.DNS.ZoneName,
		"dns.subdomains":        strings.Join(d.DNS.Subdomains, ","),
		"dns.ttl":               fmt.Sprintf("%d", d.DNS.TTL),
		"env.site_domain":       d.Env.SiteDomain,
		"env.site_label":        d.Env.SiteLabel,
		"env.aws_region":        d.Env.AWSRegion,
		"env.region_short":      d.Env.RegionShort,
		"env.local_ports.run":   fmt.Sprintf("%d", d.Env.LocalPorts.Run),
		"env.local_ports.auth":  fmt.Sprintf("%d", d.Env.LocalPorts.Auth),
		"env.local_ports.gpx":   fmt.Sprintf("%d", d.Env.LocalPorts.GPX),
		"env.local_ports.cms":   fmt.Sprintf("%d", d.Env.LocalPorts.CMS),
		"email.primary_region":  d.Email.PrimaryRegion,
		"email.smtp_prefix":     d.Email.SMTPPrefix,
		"secrets.primary_region": d.Secrets.PrimaryRegion,
		"cloudfront.domains":    strings.Join(d.CloudFront.Domains, ","),
		"cloudfront.price_class": d.CloudFront.PriceClass,
		"ec2spots.instance_type": d.EC2Spots.InstanceType,
		"ec2spots.ec2key_name_prefix": d.EC2Spots.EC2KeyNamePrefix,
		"ecs_clusters.0.name":   d.ECSClusters.Clusters[0].Name,
		"github_oidc.delegate_role_name": d.GitHubOIDC.DelegateRoleName,
		"github_oidc.ec2_runner.name": d.GitHubOIDC.EC2RunnerProfile.Name,
		"cloudtrail.log_retention_days": fmt.Sprintf("%d", d.CloudTrail.LogRetentionDays),
	}
}

func SaveConfig(path string, cfg *SiteConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
