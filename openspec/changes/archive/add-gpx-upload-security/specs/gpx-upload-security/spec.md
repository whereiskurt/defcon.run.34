# GPX Upload Security

**Status:** Draft
**Change:** add-gpx-upload-security

## ADDED Requirements

### Requirement: File Size Limits

GPX file uploads SHALL be limited to a maximum file size to prevent abuse.

#### Scenario: Upload within size limit
- **GIVEN** user attempts to upload a GPX file
- **WHEN** file size is 5 MB
- **THEN** presigned URL is generated
- **AND** upload proceeds normally

#### Scenario: Upload exceeds size limit
- **GIVEN** user attempts to upload a GPX file
- **WHEN** file size is 15 MB
- **THEN** API returns HTTP 413 (Payload Too Large)
- **AND** error message indicates "File size exceeds maximum of 10 MB"
- **AND** no presigned URL is generated

#### Scenario: S3 enforces size limit
- **GIVEN** user obtains presigned URL for 5 MB file
- **WHEN** user attempts to PUT 15 MB to presigned URL
- **THEN** S3 rejects the upload
- **AND** file is not stored

### Requirement: Upload Quota Enforcement

Users SHALL have limited upload quotas based on their tier.

#### Scenario: Upload within quota
- **GIVEN** user has 10 uploads remaining
- **WHEN** user uploads a GPX file
- **THEN** quota is decremented to 9
- **AND** response includes `quotaRemaining: 9`

#### Scenario: Upload exceeds quota
- **GIVEN** user has 0 uploads remaining
- **WHEN** user attempts to upload a GPX file
- **THEN** API returns HTTP 429 (Too Many Requests)
- **AND** error message indicates "Upload quota exceeded"
- **AND** response includes `remaining: 0` and `limit: 50`

#### Scenario: Tier-based quota limits
- **GIVEN** quota tiers are defined
- **THEN** zero tier has limit 0
- **AND** upload tier has limit 50
- **AND** admin tier has limit 500

#### Scenario: Quota restored on validation failure
- **GIVEN** user uploads an invalid file
- **WHEN** validation fails
- **THEN** quota is restored (incremented by 1)
- **AND** response indicates `quotaRestored: true`

### Requirement: GPX Content Validation

Uploaded files SHALL be validated as GPX format before being marked active.

#### Scenario: Valid GPX file confirmed
- **GIVEN** user uploads file with valid GPX content
- **WHEN** user calls confirm endpoint
- **THEN** file is validated as having `<gpx>` root element
- **AND** file status changes from 'pending' to 'active'
- **AND** response indicates success

#### Scenario: Invalid file rejected
- **GIVEN** user uploads file without GPX content (e.g., text file)
- **WHEN** user calls confirm endpoint
- **THEN** validation fails on missing `<gpx>` element
- **AND** file is deleted from S3
- **AND** file record is deleted from database
- **AND** upload quota is restored
- **AND** HTTP 400 is returned with error "Not a valid GPX file"

#### Scenario: Empty file rejected
- **GIVEN** user uploads an empty file
- **WHEN** user calls confirm endpoint
- **THEN** validation fails with "Empty file" error
- **AND** file and quota are cleaned up

### Requirement: Two-Phase Upload Flow

File uploads SHALL require confirmation to enable server-side validation.

#### Scenario: Normal upload flow
- **GIVEN** user wants to save a GPX file to cloud
- **WHEN** user initiates upload
- **THEN** API creates file record with status 'pending'
- **AND** API returns presigned upload URL
- **AND** client uploads to S3
- **AND** client calls confirm endpoint
- **AND** file becomes 'active' after validation

#### Scenario: Abandoned upload cleanup
- **GIVEN** user obtains presigned URL but never uploads
- **WHEN** 2 hours pass without confirmation
- **THEN** file record is eligible for cleanup
- **AND** cleanup process deletes record
- **AND** cleanup process restores upload quota

### Requirement: Error Response Format

API error responses SHALL provide actionable information.

#### Scenario: File too large error
- **GIVEN** file size exceeds 10 MB
- **WHEN** API returns error
- **THEN** HTTP status is 413
- **AND** body contains `{ "error": "File size exceeds maximum of 10 MB" }`

#### Scenario: Quota exceeded error
- **GIVEN** upload quota is exhausted
- **WHEN** API returns error
- **THEN** HTTP status is 429
- **AND** body contains `{ "error": "Upload quota exceeded", "remaining": 0, "limit": 50 }`

#### Scenario: Invalid GPX error
- **GIVEN** file fails GPX validation
- **WHEN** confirm API returns error
- **THEN** HTTP status is 400
- **AND** body contains `{ "error": "Not a valid GPX file (missing <gpx> element)", "quotaRestored": true }`

## MODIFIED Requirements

### Requirement: File Creation API

The file creation endpoint SHALL enforce security controls.

#### Scenario: Presign request includes size validation
- **GIVEN** user calls POST /api/gpx/files
- **WHEN** fileSize parameter is provided
- **THEN** size is validated before generating presigned URL
- **AND** presigned URL includes ContentLength constraint

#### Scenario: Presign request consumes quota
- **GIVEN** user calls POST /api/gpx/files
- **WHEN** size validation passes
- **THEN** upload quota is consumed before generating presigned URL
- **AND** file record is created with status 'pending'
