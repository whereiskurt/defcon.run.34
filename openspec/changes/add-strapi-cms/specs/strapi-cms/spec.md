## ADDED Requirements

### Requirement: CMS Master Instance
The system SHALL provide a single read/write Strapi CMS instance (master) in us-east-1 that handles all content creation and modification.

#### Scenario: Admin creates content
- **WHEN** an authenticated admin accesses `cms.defcon.run/admin`
- **THEN** the request is routed to the master instance
- **AND** the admin can create, edit, and delete content

#### Scenario: Content saved to SQLite
- **WHEN** an admin saves content changes
- **THEN** the changes are persisted to the local SQLite database
- **AND** Litestream continuously replicates the database to S3

#### Scenario: Master health check
- **WHEN** the ALB performs a health check on the master
- **THEN** the master responds with HTTP 200 if Strapi is running
- **AND** the master is removed from rotation if unhealthy

---

### Requirement: CMS Worker Instances
The system SHALL provide read-only Strapi worker instances in both regions that serve content API requests with data synchronized from S3.

#### Scenario: Worker serves API request
- **WHEN** a client requests content from `cms.defcon.run/api/*`
- **THEN** the request is routed to the nearest healthy worker
- **AND** the worker returns content from its local SQLite database

#### Scenario: Worker syncs from S3
- **WHEN** a worker has been running for 5 minutes since last sync
- **THEN** the worker downloads the latest SQLite snapshot from S3
- **AND** the worker's database is updated without service interruption

#### Scenario: Worker cold start
- **WHEN** a new worker task starts
- **THEN** Litestream restores the database from S3 before Strapi starts
- **AND** the worker becomes healthy within 120 seconds

#### Scenario: Worker rejects write operations
- **WHEN** a client attempts a write operation (POST/PUT/DELETE) on a worker
- **THEN** the worker returns HTTP 405 Method Not Allowed
- **OR** the request is proxied to the master (based on configuration)

---

### Requirement: Litestream S3 Replication
The system SHALL use Litestream to replicate the SQLite database to S3 for durability and cross-region distribution.

#### Scenario: Continuous replication from master
- **WHEN** the master commits a transaction to SQLite
- **THEN** Litestream replicates the WAL segment to S3 within 1 second
- **AND** the S3 bucket maintains a complete replication history

#### Scenario: Point-in-time recovery
- **WHEN** an operator needs to recover to a specific point in time
- **THEN** Litestream can restore the database to any WAL position
- **AND** the recovery process completes without data loss beyond the sync interval

#### Scenario: S3 bucket versioning
- **WHEN** Litestream writes to the S3 bucket
- **THEN** S3 versioning preserves previous database snapshots
- **AND** lifecycle policies expire old versions after 30 days

#### Scenario: Cross-region SSM parameter replication
- **WHEN** the Litestream bucket is created in us-east-1 (master region)
- **THEN** the s3-uploads module creates SSM parameters in us-east-1 with bucket credentials
- **AND** the `ssm_replicate_to` configuration replicates those SSM parameters to ca-central-1
- **AND** workers in ca-central-1 can read credentials from their local SSM at `/dc34/uploads/cac1/cms-litestream/*`
- **AND** all replicated parameters point to the us-east-1 bucket (bucket_region = "us-east-1")

#### Scenario: Worker accesses master bucket from different region
- **WHEN** a worker in ca-central-1 starts and needs Litestream credentials
- **THEN** ECS reads SSM parameters from ca-central-1 (`/dc34/uploads/cac1/cms-litestream/*`)
- **AND** the bucket_name parameter contains the us-east-1 bucket name
- **AND** the bucket_region parameter contains "us-east-1"
- **AND** the worker uses these credentials to access the S3 bucket cross-region

---

### Requirement: Media Asset Storage
The system SHALL store media assets uploaded through Strapi in S3 with CloudFront delivery.

#### Scenario: Admin uploads media
- **WHEN** an admin uploads an image or file through the Strapi admin panel
- **THEN** the file is stored in the S3 media bucket
- **AND** Strapi returns a CloudFront URL for the asset

#### Scenario: Media served via CloudFront
- **WHEN** a client requests a media asset from `cms.defcon.run/uploads/*`
- **THEN** CloudFront serves the asset from S3
- **AND** the asset is cached at edge locations

#### Scenario: Media cross-region replication
- **WHEN** media is uploaded to the primary S3 bucket (us-east-1)
- **THEN** S3 replication copies the asset to the secondary bucket (ca-central-1)
- **AND** CloudFront can serve from either region for redundancy

---

### Requirement: CloudFront Routing
The system SHALL route requests to `cms.defcon.run` appropriately based on path and operation type.

#### Scenario: Admin panel routing
- **WHEN** a request is made to `cms.defcon.run/admin/*`
- **THEN** CloudFront routes the request to the master instance in us-east-1
- **AND** caching is disabled for admin requests

#### Scenario: API routing with latency-based selection
- **WHEN** a request is made to `cms.defcon.run/api/*`
- **THEN** CloudFront routes to the nearest healthy worker
- **AND** responses are cached with a short TTL (60 seconds)

#### Scenario: Static asset routing
- **WHEN** a request is made to `cms.defcon.run/uploads/*`
- **THEN** CloudFront serves the asset from S3
- **AND** responses are cached with a long TTL (1 day)

---

### Requirement: CMS Authentication via OIDC
The system SHALL authenticate Strapi admin users via the auth.defcon.run OIDC provider, requiring a `services` claim that includes `cms`.

#### Scenario: Admin login via OIDC
- **WHEN** a user navigates to `cms.defcon.run/admin`
- **THEN** Strapi redirects to auth.defcon.run for OIDC authentication
- **AND** the user authenticates via their preferred provider (GitHub, Strava, Discord, email)

#### Scenario: OIDC callback with valid services claim
- **WHEN** auth.defcon.run returns an ID token with `services` claim containing `cms`
- **THEN** Strapi creates or updates the local admin user
- **AND** the user is granted access to the admin dashboard

#### Scenario: OIDC callback without cms service claim
- **WHEN** auth.defcon.run returns an ID token without `cms` in the `services` claim
- **THEN** Strapi denies access to the admin dashboard
- **AND** displays an error message indicating insufficient permissions

#### Scenario: OIDC client credentials
- **WHEN** Strapi initiates OIDC authentication
- **THEN** it uses the client_id and client_secret from SSM parameters
- **AND** the credentials are stored at `/dc34/secrets/{region}/strapi/oidc_client_id` and `/dc34/secrets/{region}/strapi/oidc_client_secret`

#### Scenario: API token authentication
- **WHEN** an external service calls the Strapi API
- **THEN** the request must include a valid API token in the Authorization header
- **AND** unauthenticated requests to protected endpoints return HTTP 401

#### Scenario: Public content access
- **WHEN** a content type is configured as public in Strapi
- **THEN** the API returns that content without authentication
- **AND** read-only access is allowed for public endpoints
