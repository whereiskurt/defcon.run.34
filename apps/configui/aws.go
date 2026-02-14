package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

type AWSStatus struct {
	Identity     *AWSIdentity              `json:"identity"`
	Error        string                    `json:"error"`
	StateBuckets map[string]ResourceStatus `json:"state_buckets"`
	LockTables   map[string]ResourceStatus `json:"lock_tables"`
}

type AWSIdentity struct {
	Account string `json:"Account"`
	ARN     string `json:"Arn"`
	UserID  string `json:"UserId"`
}

type ResourceStatus struct {
	Exists bool   `json:"exists"`
	Error  string `json:"error"`
	Name   string `json:"name"`
}

func checkAWSStatus(prefix, suffix string, regions []string) *AWSStatus {
	status := &AWSStatus{
		StateBuckets: make(map[string]ResourceStatus),
		LockTables:   make(map[string]ResourceStatus),
	}

	// Check if aws CLI exists
	if _, err := exec.LookPath("aws"); err != nil {
		status.Error = "aws CLI not installed"
		return status
	}

	// Check identity
	out, err := exec.Command("aws", "sts", "get-caller-identity", "--profile", "terraform", "--output", "json").Output()
	if err != nil {
		status.Error = "Not authenticated (run: aws sso login)"
		return status
	}
	var id AWSIdentity
	if err := json.Unmarshal(out, &id); err != nil {
		status.Error = fmt.Sprintf("Failed to parse identity: %v", err)
		return status
	}
	status.Identity = &id

	// Check state buckets and lock tables in parallel
	regionMap := map[string]string{
		"use1":  "us-east-1",
		"cac1":  "ca-central-1",
		"apse1": "ap-southeast-1",
	}

	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, regionLabel := range regions {
		regionFull, ok := regionMap[regionLabel]
		if !ok {
			continue
		}
		name := fmt.Sprintf("%s-%s-%s", prefix, regionLabel, suffix)

		wg.Add(2)

		// Check S3 bucket
		go func(label, full, bucketName string) {
			defer wg.Done()
			rs := ResourceStatus{Name: bucketName}
			_, err := exec.Command("aws", "s3api", "head-bucket",
				"--bucket", bucketName,
				"--profile", "terraform",
				"--region", full).Output()
			if err != nil {
				errStr := err.Error()
				if strings.Contains(errStr, "404") || strings.Contains(errStr, "NotFound") {
					rs.Error = "not found"
				} else if strings.Contains(errStr, "403") || strings.Contains(errStr, "Forbidden") {
					rs.Error = "access denied"
					rs.Exists = true
				} else {
					rs.Error = "check failed"
				}
			} else {
				rs.Exists = true
			}
			mu.Lock()
			status.StateBuckets[label] = rs
			mu.Unlock()
		}(regionLabel, regionFull, name)

		// Check DynamoDB table
		go func(label, full, tableName string) {
			defer wg.Done()
			rs := ResourceStatus{Name: tableName}
			_, err := exec.Command("aws", "dynamodb", "describe-table",
				"--table-name", tableName,
				"--profile", "terraform",
				"--region", full,
				"--output", "json").Output()
			if err != nil {
				errStr := err.Error()
				if strings.Contains(errStr, "ResourceNotFoundException") {
					rs.Error = "not found"
				} else {
					rs.Error = "check failed"
				}
			} else {
				rs.Exists = true
			}
			mu.Lock()
			status.LockTables[label] = rs
			mu.Unlock()
		}(regionLabel, regionFull, name)
	}

	wg.Wait()
	return status
}
