package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type DiscoveryStatus string

const (
	DiscoveryIdle    DiscoveryStatus = "idle"
	DiscoveryRunning DiscoveryStatus = "running"
	DiscoveryDone    DiscoveryStatus = "done"
	DiscoveryError   DiscoveryStatus = "error"
)

type RegionCheck struct {
	Region string `json:"region"` // "us-east-1"
	Label  string `json:"label"`  // "use1"
	Exists bool   `json:"exists"`
	Error  string `json:"error,omitempty"`
	Detail string `json:"detail,omitempty"`
}

type ResourceResult struct {
	Panel   string        `json:"panel"`   // data-panel value
	Name    string        `json:"name"`    // resource identifier
	Regions []RegionCheck `json:"regions"` // per-region status
}

type DiscoveryResults struct {
	Status    DiscoveryStatus  `json:"status"`
	UpdatedAt time.Time        `json:"updated_at"`
	Resources []ResourceResult `json:"resources"`
}

// regionMap maps short labels to full region names.
var regionMap = map[string]string{
	"use1":  "us-east-1",
	"cac1":  "ca-central-1",
	"apse1": "ap-southeast-1",
}

// reverseRegionMap maps full region names to short labels.
var reverseRegionMap = map[string]string{
	"us-east-1":      "use1",
	"ca-central-1":   "cac1",
	"ap-southeast-1": "apse1",
}

// activeRegions returns moduleRegions minus any in skipRegions.
func activeRegions(moduleRegions []string, skipRegions []string) []string {
	skip := make(map[string]bool, len(skipRegions))
	for _, s := range skipRegions {
		skip[s] = true
	}
	var result []string
	for _, r := range moduleRegions {
		if !skip[r] {
			result = append(result, r)
		}
	}
	return result
}

// unique merges multiple region slices, deduplicating.
func unique(lists ...[]string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, list := range lists {
		for _, r := range list {
			if !seen[r] {
				seen[r] = true
				result = append(result, r)
			}
		}
	}
	return result
}

// activeRegionRefs returns module RegionRefs minus any with Full in skipRegions.
func activeRegionRefs(moduleRegions []RegionRef, skipRegions []string) []RegionRef {
	skip := make(map[string]bool, len(skipRegions))
	for _, s := range skipRegions {
		skip[s] = true
	}
	var result []RegionRef
	for _, r := range moduleRegions {
		if !skip[r.Full] {
			result = append(result, r)
		}
	}
	return result
}

// regionLabel returns the short label for a full region name.
func regionLabel(full string) string {
	if l, ok := reverseRegionMap[full]; ok {
		return l
	}
	return full
}

// runDiscovery builds and executes all AWS resource checks based on config.
// addResult is called as each check completes, enabling incremental UI updates.
// maxConcurrentChecks limits parallel AWS CLI calls to avoid CPU spikes.
const maxConcurrentChecks = 6

// runDiscovery runs checks for all panels, or a single panel if onlyModule is non-empty.
func runDiscovery(cfg *SiteConfig, envLocal *EnvLocalConfig, addResult func(ResourceResult), onlyModule string) {
	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, maxConcurrentChecks)

	// throttled runs fn in a goroutine, limited by the semaphore.
	throttled := func(fn func()) {
		wg.Add(1)
		go func() {
			sem <- struct{}{}
			defer func() { <-sem }()
			defer wg.Done()
			fn()
		}()
	}

	// check returns true if this panel should be checked.
	check := func(panel string) bool {
		return onlyModule == "" || onlyModule == panel
	}

	skipRegions := cfg.Site.SkipRegions

	// ECS Clusters
	if check("ecs_clusters") && len(cfg.ECSClusters.Clusters) > 0 {
		cluster := cfg.ECSClusters.Clusters[0]
		clusterName := fmt.Sprintf("%s-%s", cfg.Site.Label, cluster.Name)
		regions := activeRegions(cluster.Regions, skipRegions)
		for _, region := range regions {
			region := region
			throttled(func() {
				rc := checkECSCluster(profile, clusterName, region)
				addResult(ResourceResult{
					Panel:   "ecs_clusters",
					Name:    clusterName,
					Regions: []RegionCheck{rc},
				})
			})
		}
	}

	// ECS Services — check each service in each region
	if check("ecs_services") {
		clusterName := cfg.Site.Label + "-app"
		svcs := []struct {
			name    string
			regions []string
		}{
			{"run-auth", cfg.Services.Auth.Task.Regions},
			{"run-human", cfg.Services.Human.Task.Regions},
			{"run-cms-master", cfg.Services.CMS.MasterTask.Regions},
			{"run-cms-worker", cfg.Services.CMS.WorkerTask.Regions},
			{"run-gpx", cfg.Services.GPX.Task.Regions},
		}
		for _, svc := range svcs {
			regions := activeRegions(svc.regions, skipRegions)
			for _, region := range regions {
				svcName, region := svc.name, region
				throttled(func() {
					rc := checkECSService(profile, clusterName, svcName, region)
					addResult(ResourceResult{
						Panel:   "ecs_services",
						Name:    svcName,
						Regions: []RegionCheck{rc},
					})
				})
			}
		}
	}

	// ECS Task Definitions
	if check("ecs_tasks") {
		taskDefs := []struct {
			name    string
			regions []string
		}{
			{"run-auth", cfg.Services.Auth.Task.Regions},
			{"run-human", cfg.Services.Human.Task.Regions},
			{"run-cms-master", cfg.Services.CMS.MasterTask.Regions},
			{"run-cms-worker", cfg.Services.CMS.WorkerTask.Regions},
			{"run-gpx", cfg.Services.GPX.Task.Regions},
		}
		for _, td := range taskDefs {
			regions := activeRegions(td.regions, skipRegions)
			for _, region := range regions {
				name, region := td.name, region
				throttled(func() {
					rc := checkECSTaskDef(profile, name, region)
					addResult(ResourceResult{
						Panel:   "ecs_tasks",
						Name:    name,
						Regions: []RegionCheck{rc},
					})
				})
			}
		}
	}

	// DynamoDB tables — check in each table's replica regions
	if check("dynamodb") {
		var allTables []DynamoDBTableConfig
		allTables = append(allTables, cfg.Services.Auth.DynamoDB...)
		allTables = append(allTables, cfg.Services.Human.DynamoDB...)
		allTables = append(allTables, cfg.Services.GPX.DynamoDB...)
		for _, t := range allTables {
			regions := activeRegionRefs(t.ReplicaRegions, skipRegions)
			for _, rr := range regions {
				table, rr := t.TableName, rr
				throttled(func() {
					rc := checkDynamoDBTable(profile, table, rr.Full)
					addResult(ResourceResult{
						Panel:   "dynamodb",
						Name:    table,
						Regions: []RegionCheck{rc},
					})
				})
			}
		}
	}

	// ECR repositories — check in each region where services deploy
	if check("ecr") {
		ecrRepos := []struct {
			name    string
			regions []string
		}{
			{"run-auth", cfg.Services.Auth.Task.Regions},
			{"run-human", cfg.Services.Human.Task.Regions},
			{"run-cms", unique(cfg.Services.CMS.MasterTask.Regions, cfg.Services.CMS.WorkerTask.Regions)},
			{"run-gpx", cfg.Services.GPX.Task.Regions},
		}
		for _, repo := range ecrRepos {
			regions := activeRegions(repo.regions, skipRegions)
			for _, region := range regions {
				name, region := repo.name, region
				throttled(func() {
					rc := checkECRRepo(profile, name, region)
					addResult(ResourceResult{
						Panel:   "ecr",
						Name:    name,
						Regions: []RegionCheck{rc},
					})
				})
			}
		}
	}

	// CloudFront distributions
	if check("cloudfront") && len(cfg.CloudFront.Domains) > 0 {
		throttled(func() {
			results := checkCloudFrontDistributions(profile, cfg.CloudFront.Domains, cfg.DNS.ZoneName)
			for _, r := range results {
				addResult(r)
			}
		})
	}

	// EC2 Spots
	if check("ec2spots") {
		regions := activeRegions(cfg.EC2Spots.Regions, skipRegions)
		for _, region := range regions {
			region := region
			throttled(func() {
				rc := checkEC2Spots(profile, cfg.Site.Label, region)
				addResult(ResourceResult{
					Panel:   "ec2spots",
					Name:    "spot-instances",
					Regions: []RegionCheck{rc},
				})
			})
		}
	}

	// Email (SES)
	if check("email") {
		emailRegions := []string{cfg.Email.PrimaryRegion}
		for _, rr := range cfg.Email.ReplicaRegions {
			if rr.Full != cfg.Email.PrimaryRegion {
				emailRegions = append(emailRegions, rr.Full)
			}
		}
		emailRegions = activeRegions(emailRegions, skipRegions)
		for _, region := range emailRegions {
			region := region
			throttled(func() {
				rc := checkSESIdentity(profile, cfg.DNS.ZoneName, region)
				addResult(ResourceResult{
					Panel:   "email",
					Name:    cfg.DNS.ZoneName,
					Regions: []RegionCheck{rc},
				})
			})
		}
	}

	// Secrets (SSM)
	if check("secrets") {
		secretsRegions := []string{cfg.Secrets.PrimaryRegion}
		for _, rr := range cfg.Secrets.ReplicaRegions {
			if rr.Full != cfg.Secrets.PrimaryRegion {
				secretsRegions = append(secretsRegions, rr.Full)
			}
		}
		secretsRegions = activeRegions(secretsRegions, skipRegions)
		for _, region := range secretsRegions {
			region := region
			throttled(func() {
				path := fmt.Sprintf("/%s/secrets/%s", cfg.Site.Label, regionLabel(region))
				rc := checkSSMPath(profile, path, region)
				addResult(ResourceResult{
					Panel:   "secrets",
					Name:    path,
					Regions: []RegionCheck{rc},
				})
			})
		}
	}

	// S3 uploads buckets — single list-buckets call, match by name
	if check("s3_uploads") {
		// Use all active regions as fallback if a service has no ReplicaRegions
		fallbackRegions := activeRegionRefs(AllRegions(), skipRegions)

		s3Checks := []struct {
			uploadName string
			regions    []RegionRef
		}{
			{"run-human", cfg.Services.Human.Uploads.ReplicaRegions},
			{"cms-litestream", cfg.Services.CMS.Litestream.ReplicaRegions},
			{"cms-media", cfg.Services.CMS.Media.ReplicaRegions},
			{"run-gpx", cfg.Services.GPX.Storage.ReplicaRegions},
		}
		throttled(func() {
			bucketSet := listS3Buckets(profile)
			if bucketSet == nil {
				log.Printf("Discovery: listS3Buckets failed (nil)")
			} else {
				log.Printf("Discovery: listS3Buckets returned %d buckets", len(bucketSet))
			}
			for _, s3c := range s3Checks {
				regions := activeRegionRefs(s3c.regions, skipRegions)
				if len(regions) == 0 {
					regions = fallbackRegions
				}
				for _, rr := range regions {
					bucketName := fmt.Sprintf("uploads-%s-%s-%s-%s", cfg.Site.Label, s3c.uploadName, rr.Label, cfg.Site.RandomSuffix)
					rc := RegionCheck{Region: rr.Full, Label: rr.Label}
					if bucketSet == nil {
						rc.Error = "check failed"
					} else if bucketSet[bucketName] {
						rc.Exists = true
						rc.Detail = "exists"
					} else {
						rc.Error = "not found"
					}
					addResult(ResourceResult{
						Panel:   "s3_uploads",
						Name:    bucketName,
						Regions: []RegionCheck{rc},
					})
				}
			}
			log.Printf("Discovery: S3 uploads checks complete")
		})
	}

	// Upload Processors (Lambda functions)
	if check("upload_proc") {
		processorRegions := activeRegions(cfg.Services.Human.Task.Regions, skipRegions)
		for _, region := range processorRegions {
			region := region
			throttled(func() {
				name := fmt.Sprintf("on-upload-%s-run-human-%s", cfg.Site.Label, regionLabel(region))
				rc := checkLambdaFunction(profile, name, region)
				addResult(ResourceResult{
					Panel:   "upload_proc",
					Name:    name,
					Regions: []RegionCheck{rc},
				})
			})
			throttled(func() {
				name := fmt.Sprintf("processor-%s-run-human-%s", cfg.Site.Label, regionLabel(region))
				rc := checkLambdaFunction(profile, name, region)
				addResult(ResourceResult{
					Panel:   "upload_proc",
					Name:    name,
					Regions: []RegionCheck{rc},
				})
			})
		}
	}

	// WAF
	if check("waf") {
		throttled(func() {
			rc := checkWAF(profile)
			addResult(ResourceResult{
				Panel:   "waf",
				Name:    "waf-webacl",
				Regions: []RegionCheck{rc},
			})
		})
	}

	// GitHub OIDC (IAM is global)
	if check("github_oidc") {
		// Check OIDC provider
		throttled(func() {
			rc := checkOIDCProvider(profile)
			addResult(ResourceResult{
				Panel:   "github_oidc",
				Name:    "oidc-provider",
				Regions: []RegionCheck{rc},
			})
		})

		// Check each IAM role
		for _, role := range cfg.GitHubOIDC.Roles {
			roleName := role.Name
			throttled(func() {
				fullName := fmt.Sprintf("%s-github-%s", cfg.Site.Label, roleName)
				rc := checkIAMRole(profile, fullName)
				addResult(ResourceResult{
					Panel:   "github_oidc",
					Name:    fullName,
					Regions: []RegionCheck{rc},
				})
			})
		}
	}

	// CloudTrail
	if check("cloudtrail") {
		trailName := fmt.Sprintf("%s-cloudtrail", cfg.Site.Label)
		throttled(func() {
			rc := checkCloudTrail(profile, trailName, "us-east-1")
			addResult(ResourceResult{
				Panel:   "cloudtrail",
				Name:    trailName,
				Regions: []RegionCheck{rc},
			})
		})
	}

	wg.Wait()
}

// --- Individual AWS check functions ---

func checkECSCluster(profile, clusterName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "ecs", "describe-clusters",
		"--clusters", clusterName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	var resp struct {
		Clusters []struct {
			Status string `json:"status"`
		} `json:"clusters"`
	}
	if json.Unmarshal(out, &resp) == nil && len(resp.Clusters) > 0 && resp.Clusters[0].Status == "ACTIVE" {
		rc.Exists = true
		rc.Detail = "ACTIVE"
	} else {
		rc.Error = "inactive or missing"
	}
	return rc
}

func checkECSService(profile, clusterName, serviceName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "ecs", "describe-services",
		"--cluster", clusterName,
		"--services", serviceName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	var resp struct {
		Services []struct {
			Status string `json:"status"`
		} `json:"services"`
	}
	if json.Unmarshal(out, &resp) == nil && len(resp.Services) > 0 && resp.Services[0].Status == "ACTIVE" {
		rc.Exists = true
		rc.Detail = "ACTIVE"
	} else {
		rc.Error = "inactive or missing"
	}
	return rc
}

func checkECSTaskDef(profile, familyName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "ecs", "describe-task-definition",
		"--task-definition", familyName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not registered"
		return rc
	}
	var resp struct {
		TaskDefinition struct {
			Status string `json:"status"`
		} `json:"taskDefinition"`
	}
	if json.Unmarshal(out, &resp) == nil && resp.TaskDefinition.Status == "ACTIVE" {
		rc.Exists = true
		rc.Detail = "ACTIVE"
	} else {
		rc.Error = "inactive"
	}
	return rc
}

func checkDynamoDBTable(profile, tableName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "dynamodb", "describe-table",
		"--table-name", tableName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	var resp struct {
		Table struct {
			TableStatus string `json:"TableStatus"`
		} `json:"Table"`
	}
	if json.Unmarshal(out, &resp) == nil && resp.Table.TableStatus == "ACTIVE" {
		rc.Exists = true
		rc.Detail = "ACTIVE"
	} else {
		rc.Error = "not active"
	}
	return rc
}

func checkECRRepo(profile, repoName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	_, err := exec.Command("aws", "ecr", "describe-repositories",
		"--repository-names", repoName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	rc.Exists = true
	rc.Detail = "exists"
	return rc
}

func checkCloudFrontDistributions(profile string, domains []string, zoneName string) []ResourceResult {
	out, err := exec.Command("aws", "cloudfront", "list-distributions",
		"--profile", profile,
		"--output", "json").Output()
	if err != nil {
		var results []ResourceResult
		for _, domain := range domains {
			results = append(results, ResourceResult{
				Panel: "cloudfront",
				Name:  domain + "." + zoneName,
				Regions: []RegionCheck{{
					Region: "us-east-1",
					Label:  "global",
					Error:  "check failed",
				}},
			})
		}
		return results
	}

	var resp struct {
		DistributionList struct {
			Items []struct {
				Aliases struct {
					Items []string `json:"Items"`
				} `json:"Aliases"`
				Status string `json:"Status"`
			} `json:"Items"`
		} `json:"DistributionList"`
	}
	json.Unmarshal(out, &resp)

	// Build set of found aliases
	found := make(map[string]bool)
	for _, dist := range resp.DistributionList.Items {
		for _, alias := range dist.Aliases.Items {
			found[alias] = true
		}
	}

	var results []ResourceResult
	for _, domain := range domains {
		fqdn := domain + "." + zoneName
		rc := RegionCheck{Region: "us-east-1", Label: "global"}
		if found[fqdn] {
			rc.Exists = true
			rc.Detail = "Deployed"
		} else {
			rc.Error = "no distribution"
		}
		results = append(results, ResourceResult{
			Panel:   "cloudfront",
			Name:    fqdn,
			Regions: []RegionCheck{rc},
		})
	}
	return results
}

func checkEC2Spots(profile, siteLabel, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "ec2", "describe-instances",
		"--filters", fmt.Sprintf("Name=tag:Site,Values=%s", siteLabel),
		"Name=instance-state-name,Values=running,pending",
		"--profile", profile,
		"--region", region,
		"--query", "Reservations[].Instances[] | length(@)",
		"--output", "text").Output()
	if err != nil {
		rc.Error = "check failed"
		return rc
	}
	count := strings.TrimSpace(string(out))
	if count != "" && count != "0" {
		rc.Exists = true
		rc.Detail = count + " instances"
	} else {
		rc.Error = "none running"
	}
	return rc
}

func checkSESIdentity(profile, domain, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "ses", "get-identity-verification-attributes",
		"--identities", domain,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "check failed"
		return rc
	}
	var resp struct {
		VerificationAttributes map[string]struct {
			VerificationStatus string `json:"VerificationStatus"`
		} `json:"VerificationAttributes"`
	}
	if json.Unmarshal(out, &resp) == nil {
		if attr, ok := resp.VerificationAttributes[domain]; ok {
			if attr.VerificationStatus == "Success" {
				rc.Exists = true
				rc.Detail = "Verified"
			} else {
				rc.Error = attr.VerificationStatus
			}
		} else {
			rc.Error = "not configured"
		}
	} else {
		rc.Error = "parse error"
	}
	return rc
}

func checkSSMPath(profile, path, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "ssm", "get-parameters-by-path",
		"--path", path,
		"--max-results", "1",
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	var resp struct {
		Parameters []interface{} `json:"Parameters"`
	}
	if json.Unmarshal(out, &resp) == nil && len(resp.Parameters) > 0 {
		rc.Exists = true
		rc.Detail = "parameters exist"
	} else {
		rc.Error = "empty"
	}
	return rc
}

// listS3Buckets returns a set of all bucket names visible to the profile, or nil on error.
func listS3Buckets(profile string) map[string]bool {
	out, err := exec.Command("aws", "s3api", "list-buckets",
		"--query", "Buckets[].Name",
		"--profile", profile,
		"--output", "json").Output()
	if err != nil {
		return nil
	}
	var names []string
	if json.Unmarshal(out, &names) != nil {
		return nil
	}
	set := make(map[string]bool, len(names))
	for _, n := range names {
		set[n] = true
	}
	return set
}

func checkS3Bucket(profile, bucketName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	_, err := exec.Command("aws", "s3api", "head-bucket",
		"--bucket", bucketName,
		"--profile", profile,
		"--region", region).Output()
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "403") || strings.Contains(errStr, "Forbidden") {
			rc.Exists = true
			rc.Detail = "exists (access denied)"
		} else {
			rc.Error = "not found"
		}
		return rc
	}
	rc.Exists = true
	rc.Detail = "exists"
	return rc
}

func checkWAF(profile string) RegionCheck {
	rc := RegionCheck{Region: "us-east-1", Label: "global"}
	out, err := exec.Command("aws", "wafv2", "list-web-acls",
		"--scope", "CLOUDFRONT",
		"--profile", profile,
		"--region", "us-east-1",
		"--output", "json").Output()
	if err != nil {
		rc.Error = "check failed"
		return rc
	}
	var resp struct {
		WebACLs []struct {
			Name string `json:"Name"`
		} `json:"WebACLs"`
	}
	if json.Unmarshal(out, &resp) == nil && len(resp.WebACLs) > 0 {
		rc.Exists = true
		rc.Detail = fmt.Sprintf("%d ACL(s)", len(resp.WebACLs))
	} else {
		rc.Error = "none found"
	}
	return rc
}

func checkLambdaFunction(profile, functionName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "lambda", "get-function",
		"--function-name", functionName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	var resp struct {
		Configuration struct {
			State string `json:"State"`
		} `json:"Configuration"`
	}
	if json.Unmarshal(out, &resp) == nil && resp.Configuration.State == "Active" {
		rc.Exists = true
		rc.Detail = "Active"
	} else {
		rc.Error = "not active"
	}
	return rc
}

func checkOIDCProvider(profile string) RegionCheck {
	rc := RegionCheck{Region: "us-east-1", Label: "global"}
	out, err := exec.Command("aws", "iam", "list-open-id-connect-providers",
		"--profile", profile,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "check failed"
		return rc
	}
	var resp struct {
		OpenIDConnectProviderList []struct {
			Arn string `json:"Arn"`
		} `json:"OpenIDConnectProviderList"`
	}
	if json.Unmarshal(out, &resp) == nil {
		for _, p := range resp.OpenIDConnectProviderList {
			if strings.Contains(p.Arn, "token.actions.githubusercontent.com") {
				rc.Exists = true
				rc.Detail = "GitHub Actions"
				return rc
			}
		}
	}
	rc.Error = "not found"
	return rc
}

func checkIAMRole(profile, roleName string) RegionCheck {
	rc := RegionCheck{Region: "us-east-1", Label: "global"}
	_, err := exec.Command("aws", "iam", "get-role",
		"--role-name", roleName,
		"--profile", profile,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	rc.Exists = true
	rc.Detail = "exists"
	return rc
}

func checkInstanceProfile(profile, profileName string) RegionCheck {
	rc := RegionCheck{Region: "us-east-1", Label: "global"}
	_, err := exec.Command("aws", "iam", "get-instance-profile",
		"--instance-profile-name", profileName,
		"--profile", profile,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	rc.Exists = true
	rc.Detail = "exists"
	return rc
}

func checkCloudTrail(profile, trailName, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "cloudtrail", "get-trail-status",
		"--name", trailName,
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "not found"
		return rc
	}
	var resp struct {
		IsLogging bool `json:"IsLogging"`
	}
	if json.Unmarshal(out, &resp) == nil && resp.IsLogging {
		rc.Exists = true
		rc.Detail = "logging"
	} else {
		rc.Exists = true
		rc.Detail = "stopped"
	}
	return rc
}
