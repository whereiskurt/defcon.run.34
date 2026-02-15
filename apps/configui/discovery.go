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
func runDiscovery(cfg *SiteConfig, envLocal *EnvLocalConfig, addResult func(ResourceResult)) {
	profile := "terraform"
	if envLocal.ProfilePrefix != "" {
		profile = envLocal.ProfilePrefix + "-terraform"
	}

	var wg sync.WaitGroup

	skipRegions := cfg.Site.SkipRegions

	// ECS Clusters
	if len(cfg.ECSClusters.Clusters) > 0 {
		cluster := cfg.ECSClusters.Clusters[0]
		clusterName := fmt.Sprintf("%s-%s", cfg.Site.Label, cluster.Name)
		regions := activeRegions(cluster.Regions, skipRegions)
		for _, region := range regions {
			wg.Add(1)
			go func(region string) {
				defer wg.Done()
				rc := checkECSCluster(profile, clusterName, region)
				addResult(ResourceResult{
					Panel:   "ecs_clusters",
					Name:    clusterName,
					Regions: []RegionCheck{rc},
				})
			}(region)
		}
	}

	// ECS Services — check each service in each region
	{
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
				wg.Add(1)
				go func(svcName, region string) {
					defer wg.Done()
					rc := checkECSService(profile, clusterName, svcName, region)
					addResult(ResourceResult{
						Panel:   "ecs_services",
						Name:    svcName,
						Regions: []RegionCheck{rc},
					})
				}(svc.name, region)
			}
		}
	}

	// ECS Task Definitions
	{
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
				wg.Add(1)
				go func(name, region string) {
					defer wg.Done()
					rc := checkECSTaskDef(profile, name, region)
					addResult(ResourceResult{
						Panel:   "ecs_tasks",
						Name:    name,
						Regions: []RegionCheck{rc},
					})
				}(td.name, region)
			}
		}
	}

	// DynamoDB tables — check in each table's replica regions
	{
		var allTables []DynamoDBTableConfig
		allTables = append(allTables, cfg.Services.Auth.DynamoDB...)
		allTables = append(allTables, cfg.Services.Human.DynamoDB...)
		allTables = append(allTables, cfg.Services.GPX.DynamoDB...)
		for _, t := range allTables {
			regions := activeRegionRefs(t.ReplicaRegions, skipRegions)
			for _, rr := range regions {
				wg.Add(1)
				go func(table string, rr RegionRef) {
					defer wg.Done()
					rc := checkDynamoDBTable(profile, table, rr.Full)
					addResult(ResourceResult{
						Panel:   "dynamodb",
						Name:    table,
						Regions: []RegionCheck{rc},
					})
				}(t.TableName, rr)
			}
		}
	}

	// ECR repositories — check in each region where services deploy
	{
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
				wg.Add(1)
				go func(name, region string) {
					defer wg.Done()
					rc := checkECRRepo(profile, name, region)
					addResult(ResourceResult{
						Panel:   "ecr",
						Name:    name,
						Regions: []RegionCheck{rc},
					})
				}(repo.name, region)
			}
		}
	}

	// CloudFront distributions
	if len(cfg.CloudFront.Domains) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results := checkCloudFrontDistributions(profile, cfg.CloudFront.Domains, cfg.DNS.ZoneName)
			for _, r := range results {
				addResult(r)
			}
		}()
	}

	// EC2 Spots
	{
		regions := activeRegions(cfg.EC2Spots.Regions, skipRegions)
		for _, region := range regions {
			wg.Add(1)
			go func(region string) {
				defer wg.Done()
				rc := checkEC2Spots(profile, cfg.Site.Label, region)
				addResult(ResourceResult{
					Panel:   "ec2spots",
					Name:    "spot-instances",
					Regions: []RegionCheck{rc},
				})
			}(region)
		}
	}

	// Email (SES)
	{
		emailRegions := []string{cfg.Email.PrimaryRegion}
		for _, rr := range cfg.Email.ReplicaRegions {
			if rr.Full != cfg.Email.PrimaryRegion {
				emailRegions = append(emailRegions, rr.Full)
			}
		}
		emailRegions = activeRegions(emailRegions, skipRegions)
		for _, region := range emailRegions {
			wg.Add(1)
			go func(region string) {
				defer wg.Done()
				rc := checkSESIdentity(profile, cfg.DNS.ZoneName, region)
				addResult(ResourceResult{
					Panel:   "email",
					Name:    cfg.DNS.ZoneName,
					Regions: []RegionCheck{rc},
				})
			}(region)
		}
	}

	// Secrets (SSM)
	{
		secretsRegions := []string{cfg.Secrets.PrimaryRegion}
		for _, rr := range cfg.Secrets.ReplicaRegions {
			if rr.Full != cfg.Secrets.PrimaryRegion {
				secretsRegions = append(secretsRegions, rr.Full)
			}
		}
		secretsRegions = activeRegions(secretsRegions, skipRegions)
		for _, region := range secretsRegions {
			wg.Add(1)
			go func(region string) {
				defer wg.Done()
				path := fmt.Sprintf("/%s/secrets/%s", cfg.Site.Label, regionLabel(region))
				rc := checkSSMPath(profile, path, region)
				addResult(ResourceResult{
					Panel:   "secrets",
					Name:    path,
					Regions: []RegionCheck{rc},
				})
			}(region)
		}
	}

	// S3 uploads buckets — single list-buckets call, match by name
	{
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
		wg.Add(1)
		go func() {
			defer wg.Done()
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
		}()
	}

	// Upload Processors (Lambda functions)
	{
		processorRegions := activeRegions(cfg.Services.Human.Task.Regions, skipRegions)
		for _, region := range processorRegions {
			wg.Add(2)
			go func(region string) {
				defer wg.Done()
				name := fmt.Sprintf("on-upload-%s-run-human-%s", cfg.Site.Label, regionLabel(region))
				rc := checkLambdaFunction(profile, name, region)
				addResult(ResourceResult{
					Panel:   "upload_proc",
					Name:    name,
					Regions: []RegionCheck{rc},
				})
			}(region)
			go func(region string) {
				defer wg.Done()
				name := fmt.Sprintf("processor-%s-run-human-%s", cfg.Site.Label, regionLabel(region))
				rc := checkLambdaFunction(profile, name, region)
				addResult(ResourceResult{
					Panel:   "upload_proc",
					Name:    name,
					Regions: []RegionCheck{rc},
				})
			}(region)
		}
	}

	// WAF
	{
		wg.Add(1)
		go func() {
			defer wg.Done()
			rc := checkWAF(profile)
			addResult(ResourceResult{
				Panel:   "waf",
				Name:    "waf-webacl",
				Regions: []RegionCheck{rc},
			})
		}()
	}

	// GitHub OIDC (IAM is global)
	{
		// Check OIDC provider
		wg.Add(1)
		go func() {
			defer wg.Done()
			rc := checkOIDCProvider(profile)
			addResult(ResourceResult{
				Panel:   "github_oidc",
				Name:    "oidc-provider",
				Regions: []RegionCheck{rc},
			})
		}()

		// Check each IAM role
		for _, role := range cfg.GitHubOIDC.Roles {
			wg.Add(1)
			go func(roleName string) {
				defer wg.Done()
				fullName := fmt.Sprintf("%s-github-%s", cfg.Site.Label, roleName)
				rc := checkIAMRole(profile, fullName)
				addResult(ResourceResult{
					Panel:   "github_oidc",
					Name:    fullName,
					Regions: []RegionCheck{rc},
				})
			}(role.Name)
		}

		// Note: delegate role lives in the management account, not checkable
		// from the terraform profile. Skipped.

		// Note: EC2 runner instance profile/role is optional infrastructure,
		// often not deployed. Skipped to avoid false negatives.
	}

	// CloudTrail
	{
		wg.Add(1)
		go func() {
			defer wg.Done()
			rc := checkCloudTrail(profile, "us-east-1")
			addResult(ResourceResult{
				Panel:   "cloudtrail",
				Name:    "trail",
				Regions: []RegionCheck{rc},
			})
		}()
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

func checkCloudTrail(profile, region string) RegionCheck {
	rc := RegionCheck{Region: region, Label: regionLabel(region)}
	out, err := exec.Command("aws", "cloudtrail", "describe-trails",
		"--profile", profile,
		"--region", region,
		"--output", "json").Output()
	if err != nil {
		rc.Error = "check failed"
		return rc
	}
	var resp struct {
		TrailList []struct {
			Name string `json:"Name"`
		} `json:"trailList"`
	}
	if json.Unmarshal(out, &resp) == nil && len(resp.TrailList) > 0 {
		rc.Exists = true
		rc.Detail = fmt.Sprintf("%d trail(s)", len(resp.TrailList))
	} else {
		rc.Error = "no trails"
	}
	return rc
}
