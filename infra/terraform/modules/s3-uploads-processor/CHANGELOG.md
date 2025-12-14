# Changelog

All notable changes to the s3-uploads-processor module will be documented in this file.

## [v1.0.0] - 2024-12-13

### Added
- Initial release of s3-uploads-processor module (renamed from upload-processor)
- SNS topic for S3 upload notifications
- S3 bucket notification configuration for uploads/ prefix
- on-upload Lambda function:
  - Triggered by SNS on S3 ObjectCreated events
  - Parses S3 key to extract userId, uploadType, uploadId
  - Updates ElectroDB UserUpload record with status="uploaded"
- processor Lambda function:
  - Triggered by DynamoDB Streams on status change to "uploaded"
  - GPX processing: parses XML, calculates distance/elevation/duration
  - Photo processing: placeholder for future resize/AI tagging
  - Writes processed files to processed/ folder
  - Updates record with status="completed" and processedData
- IAM roles with least-privilege policies for both Lambdas
- CloudWatch Log Groups with 14-day retention
- DynamoDB Stream event source mapping with filter criteria

### Lambda Runtimes
- Python 3.12 for both Lambda functions

### Configuration
- Configurable timeout and memory for each Lambda
- Supports multi-region deployment
