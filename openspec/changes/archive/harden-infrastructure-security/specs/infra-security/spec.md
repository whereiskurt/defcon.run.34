# Infrastructure Security Baseline

## ADDED Requirements

### Requirement: Security Group Documentation

All security group rules SHALL have a description field explaining the purpose of the rule.

#### Scenario: Ingress rule has description
- **WHEN** a security group ingress rule is defined
- **THEN** it MUST include a `description` field explaining what traffic is allowed and why

#### Scenario: Egress rule has description
- **WHEN** a security group egress rule is defined
- **THEN** it MUST include a `description` field explaining what outbound traffic is permitted

### Requirement: ACM Certificate Lifecycle

ACM certificates SHALL use `create_before_destroy` lifecycle to ensure zero-downtime during renewal.

#### Scenario: Certificate renewal
- **WHEN** an ACM certificate approaches expiration
- **THEN** the new certificate is created before the old one is destroyed
- **AND** no service disruption occurs

### Requirement: ECR Security Defaults

ECR repositories SHALL have security features enabled by default.

#### Scenario: Image scanning enabled
- **WHEN** an ECR repository is created
- **THEN** `scan_on_push` is enabled by default
- **AND** images are scanned for vulnerabilities on push

#### Scenario: Immutable tags
- **WHEN** an ECR repository is created
- **THEN** `image_tag_mutability` is set to `IMMUTABLE` by default
- **AND** tags cannot be overwritten

### Requirement: ECS Container Insights

ECS clusters SHALL have Container Insights enabled for observability.

#### Scenario: Container metrics collection
- **WHEN** an ECS cluster is created
- **THEN** Container Insights is enabled
- **AND** container-level metrics are sent to CloudWatch

### Requirement: KMS Encryption for Data at Rest

All sensitive data SHALL be encrypted using customer-managed KMS keys.

#### Scenario: SSM Parameter encryption
- **WHEN** a SecureString SSM parameter is created
- **THEN** it is encrypted with a KMS CMK
- **AND** the key policy restricts access to authorized principals

#### Scenario: DynamoDB table encryption
- **WHEN** a DynamoDB table is created
- **THEN** it is encrypted with a KMS CMK
- **AND** AWS-managed encryption is not used

#### Scenario: S3 bucket encryption
- **WHEN** an S3 bucket is created
- **THEN** server-side encryption uses KMS
- **AND** AES256 is not the default encryption method

#### Scenario: ECR repository encryption
- **WHEN** an ECR repository is created
- **THEN** it is encrypted with a KMS CMK

#### Scenario: Secrets Manager encryption
- **WHEN** a Secrets Manager secret is created
- **THEN** it is encrypted with a KMS CMK

#### Scenario: CloudWatch Logs encryption
- **WHEN** a CloudWatch Log Group is created
- **THEN** it is encrypted with a KMS CMK

### Requirement: DynamoDB Point-in-Time Recovery

DynamoDB tables SHALL have point-in-time recovery enabled for disaster recovery.

#### Scenario: PITR enabled on tables
- **WHEN** a DynamoDB table is created
- **THEN** point-in-time recovery is enabled
- **AND** recovery is possible to any point within the last 35 days
