# GPX File Sharing

**Status:** Draft
**Change:** add-gpx-versioning-sharing

## ADDED Requirements

### Requirement: Share Link Generation

The system SHALL allow users to generate shareable URLs for specific file versions.

#### Scenario: Create public share
- Given a file at version 3
- When the user clicks Share and selects "Public"
- Then a share token is generated (nanoid, 21 chars)
- And a share URL is displayed: `https://gpx.defcon.run/share/{token}`
- And the share record links to fileId and version 3

#### Scenario: Create private share
- Given a file at version 2
- When the user clicks Share and selects "Private"
- And enters email "friend@example.com"
- Then a share token is generated
- And the share record includes allowedEmails=["friend@example.com"]

#### Scenario: Multiple emails for private share
- Given a private share dialog
- When the user enters multiple emails
- Then all emails are stored in allowedEmails list
- And each email recipient can access the share

### Requirement: Share Access Control

The system MUST validate access to shared links based on mode and authentication.

#### Scenario: Public share access
- Given a public share link
- When any authenticated user visits the link
- Then the share metadata is returned
- And the user can accept (copy) the file

#### Scenario: Public share requires authentication
- Given a public share link
- When an unauthenticated user visits the link
- Then they are redirected to login
- And returned to the share page after authentication

#### Scenario: Private share access granted
- Given a private share with allowedEmails=["user@example.com"]
- When user@example.com visits the share link
- Then the share metadata is returned
- And the user can accept (copy) the file

#### Scenario: Private share access denied
- Given a private share with allowedEmails=["user@example.com"]
- When other@example.com visits the share link
- Then access is denied with error "This share is not available to you"

### Requirement: Share Acceptance (Copy on Open)

The system SHALL create a copy in the recipient's storage when they accept a shared link.

#### Scenario: Accept shared file
- Given a valid share link for file "RouteMap.gpx" at version 3
- When the authenticated user clicks "Add to My Files"
- Then the version 3 content is copied to user's S3 storage
- And a new GpxFile record is created with version=1
- And the file is loaded into the user's GPX Studio session

#### Scenario: Copy includes metadata
- Given a shared file with trackCount=5 and bounds data
- When the recipient accepts the share
- Then the copied file includes all metadata from the original
- And fileName is preserved (or appended with " (Copy)" if duplicate)

#### Scenario: Multiple accepts create separate copies
- Given user A accepts a share and later user B accepts the same share
- Then user A has their own copy
- And user B has their own copy
- And modifications by either user do not affect the other

### Requirement: Share Management

File owners SHALL be able to view and revoke shares they created.

#### Scenario: List shares for file
- Given a file with 3 active shares
- When the owner opens the share dialog
- Then all 3 shares are displayed with creation date and access mode

#### Scenario: Revoke share
- Given an active share
- When the owner clicks "Revoke"
- Then the share record is deleted
- And the share URL no longer works

#### Scenario: Cascade delete on file deletion
- Given a file with 2 shares
- When the file is deleted
- Then both share records are automatically deleted

### Requirement: GpxShare Entity

A new DynamoDB entity MUST store share metadata.

#### Scenario: Share entity attributes
- Given a GpxShare entity
- Then it includes shareId (string, primary key)
- And ownerId (string, file owner's userId)
- And fileId (string, reference to GpxFile)
- And version (number, specific version shared)
- And accessMode (enum: "public" | "private")
- And allowedEmails (list of strings, for private mode)
- And createdAt (timestamp)

#### Scenario: Query shares by file
- Given shares for fileId "abc123"
- When querying byFile index with ownerId and fileId
- Then all shares for that file are returned
