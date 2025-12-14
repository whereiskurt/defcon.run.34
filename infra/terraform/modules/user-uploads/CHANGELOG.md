# Changelog

All notable changes to the user-uploads module will be documented in this file.

## [v1.0.0] - 2024-12-13

### Added
- Initial release of user-uploads module
- S3 bucket creation with configurable naming (`uploads-{site}-{name}-{region}-{suffix}`)
- Two-folder structure:
  - `uploads/` - For user uploads with auto-expiration
  - `processed/` - For post-processing output with optional expiration
- User isolation via path-based prefixes and object tagging
- IAM user for presigned URL generation with scoped permissions
- SSM parameter storage for credentials and bucket info
- Cross-region replication (following email module pattern)
- CORS configuration for browser uploads
- Server-side encryption (AES256)
- Public access blocking
- HTTPS-only bucket policy
- Lifecycle rules for automatic cleanup
- Multipart upload abort rule (7 days)

### Security Features
- Presigner IAM user limited to `uploads/*` prefix only
- Tag-based access control support for user isolation
- All public access blocked
- Encryption at rest
- TLS required for all access
