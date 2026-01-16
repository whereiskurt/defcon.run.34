# GPX File Versioning

**Status:** Draft
**Change:** add-gpx-versioning-sharing

## ADDED Requirements

### Requirement: Automatic Version Increment on Save

The system SHALL create a new version every time a file is saved to cloud storage.

#### Scenario: First save creates version 1
- Given a new GPX file not yet saved to cloud
- When the user saves to cloud storage
- Then the file is created with version=1
- And versionCount=1

#### Scenario: Subsequent save increments version
- Given an existing cloud file at version 3
- When the user saves changes to the file
- Then a new version 4 is created
- And version is updated to 4
- And versionCount is updated to 4

#### Scenario: Version stored as separate S3 object
- Given a file with fileId "abc123" at version 3
- When version 4 is saved
- Then S3 contains object at key `uploads/{userId}/gpx/abc123.v4.gpx`
- And the current key `uploads/{userId}/gpx/abc123.gpx` is updated to match v4

### Requirement: Version History Access

The system SHALL provide access to previous versions of files stored in cloud storage.

#### Scenario: View version history in Cloud Storage
- Given a file with 5 versions
- When the user views the file in Cloud Storage dialog
- Then a version indicator shows "v5"
- And a dropdown allows selecting versions 1-5

#### Scenario: Load previous version
- Given a file with version 3 as current
- When the user selects version 1 from history
- Then version 1 content is loaded into the map
- And the file remains at version 3 (read-only historical view)

### Requirement: Version Limit and Pruning

The system SHALL enforce a maximum version limit and MUST automatically prune oldest versions.

#### Scenario: Maximum version limit
- Given a file at version 50 (maximum)
- When the user saves a new version
- Then version 51 is created
- And version 1 (oldest) is automatically deleted from S3
- And versionCount remains 50

#### Scenario: Version count configuration
- Given the system configuration
- Then MAX_VERSIONS is set to 50
- And this limit applies per-file

## MODIFIED Requirements

### Requirement: GpxFile Entity Schema

The GpxFile DynamoDB entity MUST include version tracking attributes.

#### Scenario: Version attributes present
- Given a GpxFile entity
- Then it includes `version` attribute (number, default 1)
- And it includes `versionCount` attribute (number, default 1)

#### Scenario: Existing files migrated
- Given existing files without version attributes
- When accessed after migration
- Then version defaults to 1
- And versionCount defaults to 1
