# GPX Menu Restructure

**Status:** Draft
**Change:** add-gpx-versioning-sharing

## MODIFIED Requirements

### Requirement: File Menu Organization

The File menu SHALL provide local file operations and quick cloud save.

#### Scenario: Local Open replaces Open
- Given the File menu
- When the user opens the menu
- Then "Local Open" (Ctrl+O) opens the local file picker
- And "Open" is no longer displayed

#### Scenario: Save to Cloud menu item
- Given the File menu
- When the user opens the menu
- Then "Save to Cloud" (Ctrl+Shift+K) is available
- And it appears after "Local Open"

#### Scenario: Cloud Storage removed from File menu
- Given the File menu
- When the user opens the menu
- Then "Cloud Storage" is not present
- And it has been moved to View menu

### Requirement: View Menu Organization

The View menu SHALL include Cloud Storage access.

#### Scenario: Cloud Storage in View menu
- Given the View menu
- When the user opens the menu
- Then "Cloud Storage" appears after "Tree File View"
- And before "Switch Basemap"

### Requirement: Quick Save to Cloud

Save to Cloud SHALL save selected layers without opening the dialog.

#### Scenario: Quick save uses last folder
- Given the user last saved to folder "Routes"
- And layers are selected
- When the user triggers Save to Cloud (Ctrl+Shift+K)
- Then selected layers are saved to "Routes" folder
- And the Cloud Storage dialog does not open

#### Scenario: Quick save with no previous folder
- Given the user has never saved to cloud (no lastSaveFolder)
- And layers are selected
- When the user triggers Save to Cloud
- Then selected layers are saved to ROOT folder
- And lastSaveFolder is set to ROOT

#### Scenario: Quick save overwrites existing files
- Given a layer named "MyRoute.gpx"
- And a cloud file "MyRoute.gpx" exists in the target folder
- When the user triggers Save to Cloud
- Then the existing file is updated (new version created)
- And no duplicate file is created

#### Scenario: Quick save creates new files
- Given a layer named "NewRoute.gpx"
- And no cloud file "NewRoute.gpx" exists in the target folder
- When the user triggers Save to Cloud
- Then a new file is created with version=1

#### Scenario: Quick save with no layers selected
- Given no layers are selected
- When the user triggers Save to Cloud
- Then all layers are saved (same as "Save All" behavior)

### Requirement: Folder Memory Persistence

The system SHALL remember the last used folder across sessions.

#### Scenario: Folder saved on manual save
- Given the user is in folder "Events/2026"
- When the user saves a file via Cloud Storage dialog
- Then lastSaveFolder is updated to "Events/2026" folderId

#### Scenario: Folder persisted to settings
- Given lastSaveFolder is set to folder "abc123"
- When the user closes and reopens the browser
- Then lastSaveFolder is restored to "abc123"

#### Scenario: Invalid folder falls back to ROOT
- Given lastSaveFolder references a deleted folder
- When the user triggers Save to Cloud
- Then save proceeds to ROOT folder
- And lastSaveFolder is reset to ROOT
