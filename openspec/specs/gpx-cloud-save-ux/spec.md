# gpx-cloud-save-ux Specification

## Purpose
Cloud storage UX for the GPX editor (run.gpx), providing save/copy semantics, layer selection, folder organization, version history, and file sharing via the gpx-studio SvelteKit frontend backed by S3 and DynamoDB.

## Requirements

### Requirement: Save vs Copy Semantics
The cloud storage UI SHALL distinguish between "Save" (overwrite existing) and "Copy" (create new file).

#### Scenario: Save overwrites existing file
- **WHEN** a user saves a file with a name matching an existing file in the current folder
- **THEN** the existing file's content is overwritten via presigned S3 PUT
- **AND** the file version is incremented

#### Scenario: Save creates new file when no match
- **WHEN** a user saves a file with no name match in the current folder
- **THEN** a new file is created (same behavior as copy)

#### Scenario: Copy always creates new file
- **WHEN** a user uses the "Copy" action
- **THEN** a new file is always created regardless of name matches

### Requirement: Layer Selection
The cloud storage UI SHALL allow users to select which loaded layers to save.

#### Scenario: Layer selection checkboxes
- **GIVEN** multiple GPX layers are loaded in the editor
- **WHEN** the cloud storage dialog opens in save mode
- **THEN** each layer is shown with a checkbox (all selected by default)
- **AND** "Select All" and "Select None" controls are available

#### Scenario: Saving selected layers
- **WHEN** the user clicks Save or Copy with some layers unchecked
- **THEN** only checked layers are saved to the cloud

### Requirement: Folder Organization
The system SHALL support hierarchical folder organization for cloud files.

#### Scenario: Navigate folders
- **WHEN** a user clicks a folder in the file listing
- **THEN** the view navigates into that folder with breadcrumb trail

#### Scenario: Create folder
- **WHEN** a user creates a new folder
- **THEN** the folder appears in the current directory

#### Scenario: Global folders
- **GIVEN** the user is at the root level
- **WHEN** the file listing loads
- **THEN** both user folders and global (shared) folders are displayed

### Requirement: Version History
The system SHALL maintain version history for cloud files (up to 50 versions via S3 versioning).

#### Scenario: View version history
- **WHEN** a user opens the version history for a file
- **THEN** available versions are listed with timestamps

#### Scenario: Load specific version
- **WHEN** a user selects a previous version
- **THEN** that version's content is loaded into the editor

### Requirement: File Sharing
The system SHALL support public and private share links for cloud files.

#### Scenario: Create public share link
- **WHEN** a user creates a public share for a file
- **THEN** a share URL is generated that anyone can access

#### Scenario: Share URL format
- **GIVEN** production environment
- **WHEN** a share URL is generated
- **THEN** it follows the pattern `https://gpx.defcon.run/{region}/studio/share/{shareId}`

#### Scenario: Local development share URL
- **GIVEN** development environment
- **WHEN** a share URL is generated
- **THEN** no region prefix is included: `http://localhost:3003/studio/share/{shareId}`

### Requirement: File Size and Quota Limits
The system SHALL enforce file size limits and upload quotas.

#### Scenario: File too large
- **WHEN** a user uploads a file exceeding 10 MB
- **THEN** the upload is rejected with a clear error message

#### Scenario: Quota exceeded
- **WHEN** a user exceeds their upload quota
- **THEN** the upload is rejected with a 429 status and remaining quota info

### Requirement: GPX Binary Validation
The system SHALL validate uploaded files are valid GPX format.

#### Scenario: Valid GPX upload
- **WHEN** a user uploads a valid GPX file
- **THEN** the file is confirmed and activated after S3 upload

#### Scenario: Invalid GPX upload
- **WHEN** a user uploads an invalid GPX file
- **THEN** the upload still counts against quota
- **AND** an error message indicates the validation failure

## Implementation Notes

- Cloud sync layer: `apps/run.gpx/gpx-studio/website/src/lib/cloud-sync.ts`
- UI component: `apps/run.gpx/gpx-studio/website/src/lib/components/cloud/CloudStorage.svelte`
- Share dialogs: `ShareDialog.svelte`, `ShareAcceptDialog.svelte`
- Key functions: `saveOrUpdateToCloud`, `updateCloudFileContent`, `findCloudFileByName`
- API base: `/{region}/api/gpx/` (files, folders, shares, download/presign)
- Layout: Remote files expanded by default, save/copy controls below file listing
