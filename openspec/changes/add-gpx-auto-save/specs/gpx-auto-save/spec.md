# GPX Auto-Save to Cloud

## ADDED Requirements

### Requirement: Auto-Save Trigger

The system SHALL automatically save cloud-linked GPX files to cloud storage at a 10-minute interval when changes are detected.

#### Scenario: Auto-save with changes
- **GIVEN** a file is cloud-linked (opened from or saved to cloud)
- **AND** auto-save is enabled
- **AND** 10 minutes have elapsed since last check
- **WHEN** the content hash differs from the last saved hash
- **THEN** the system saves the file to cloud storage
- **AND** increments the file version
- **AND** updates the last saved hash

#### Scenario: Auto-save without changes
- **GIVEN** a file is cloud-linked
- **AND** auto-save is enabled
- **AND** 10 minutes have elapsed since last check
- **WHEN** the content hash matches the last saved hash
- **THEN** the system does NOT save the file
- **AND** no new version is created

### Requirement: Cloud-Linked File Detection

The system SHALL track files as "cloud-linked" when they are opened from cloud storage or first saved to cloud storage.

#### Scenario: File opened from cloud
- **WHEN** a user opens a file from cloud storage
- **THEN** the file is registered as cloud-linked
- **AND** auto-save tracking begins for that file

#### Scenario: File saved to cloud
- **WHEN** a user saves a local file to cloud storage for the first time
- **THEN** the file becomes cloud-linked
- **AND** auto-save tracking begins for that file

#### Scenario: File closed
- **WHEN** a user closes a cloud-linked file
- **THEN** the file is unregistered from auto-save tracking

### Requirement: Auto-Save Toggle

The system SHALL provide a user-accessible toggle to enable or disable auto-save, defaulting to enabled.

#### Scenario: Toggle in File menu
- **GIVEN** the user opens the File menu
- **THEN** an "Auto-Save" checkbox item is visible
- **AND** the checkbox reflects the current auto-save state

#### Scenario: Disable auto-save
- **WHEN** the user unchecks "Auto-Save"
- **THEN** the auto-save timer stops
- **AND** no automatic saves occur until re-enabled

#### Scenario: Enable auto-save
- **WHEN** the user checks "Auto-Save"
- **THEN** the auto-save timer starts
- **AND** automatic saves resume at the next interval

### Requirement: Auto-Save Status Indicator

The system SHALL display a subtle indicator showing the current auto-save status.

#### Scenario: Saving in progress
- **WHEN** an auto-save is in progress
- **THEN** the indicator shows "Saving..." state

#### Scenario: Save completed
- **WHEN** an auto-save completes successfully
- **THEN** the indicator briefly shows "Saved" state
- **AND** fades to idle after a few seconds

#### Scenario: Offline state
- **WHEN** the system detects offline status
- **THEN** the indicator shows "Offline" state

### Requirement: Offline Handling

The system SHALL handle offline conditions gracefully and sync when connectivity returns.

#### Scenario: Auto-save while offline
- **GIVEN** the system is offline
- **WHEN** the auto-save interval triggers
- **THEN** the system marks files as "needs sync"
- **AND** does NOT attempt network requests

#### Scenario: Coming back online
- **WHEN** the system detects connectivity restored
- **THEN** the system checks for files marked "needs sync"
- **AND** triggers an immediate save for changed files

### Requirement: Tab Close Save

The system SHALL attempt to save pending changes when the browser tab is closed.

#### Scenario: Tab close with changes
- **GIVEN** a cloud-linked file has unsaved changes
- **WHEN** the user closes the tab or navigates away
- **THEN** the system attempts to save the changes
- **AND** uses `sendBeacon` or synchronous fetch as fallback

#### Scenario: Tab close without changes
- **GIVEN** no cloud-linked files have unsaved changes
- **WHEN** the user closes the tab
- **THEN** no save attempt is made

### Requirement: Change Detection via Content Hash

The system SHALL use content hashing to detect actual changes, avoiding unnecessary version increments.

#### Scenario: Hash calculation
- **WHEN** a file is checked for changes
- **THEN** the system computes a hash of the current GPX content
- **AND** compares it to the hash from the last successful save

#### Scenario: Identical content
- **GIVEN** the user opens a file, views it, and makes no edits
- **WHEN** the auto-save interval triggers
- **THEN** no save occurs because the hash is unchanged

### Requirement: Conflict Resolution

The system SHALL use last-write-wins strategy for concurrent edits.

#### Scenario: Concurrent edit from another session
- **GIVEN** the same file is edited in two browser tabs
- **WHEN** both tabs auto-save
- **THEN** the last save overwrites the previous
- **AND** each save creates a new version (history preserved)
