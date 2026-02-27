# GPX Cloud Dialog

**Status:** Draft
**Change:** refactor-gpx-cloud-dialog

## ADDED Requirements

### Requirement: Cloud Storage Dialog Modes

The Cloud Storage dialog SHALL operate in three distinct modes based on how it is opened.

#### Scenario: Save mode from Save As menu
- **WHEN** user selects "Save As..." from File menu
- **THEN** dialog opens in "save" mode
- **AND** dialog title displays "Save to Cloud"
- **AND** "Layers to Save" section is expanded
- **AND** "Remote Files" section is collapsed
- **AND** only "Save" button is shown

#### Scenario: Open mode from Open Remote menu
- **WHEN** user selects "Open Remote..." from File menu
- **THEN** dialog opens in "open" mode
- **AND** dialog title displays "Open from Cloud"
- **AND** "Layers to Save" section is collapsed
- **AND** "Remote Files" section is expanded
- **AND** only "Open Selected" button is shown

#### Scenario: Browse mode from View menu
- **WHEN** user selects "Cloud Storage" from View menu
- **THEN** dialog opens in "browse" mode
- **AND** dialog title displays "Cloud Storage"
- **AND** both sections are expanded
- **AND** both "Save" and "Open Selected" buttons are shown

### Requirement: Batch File Selection for Opening

The Remote Files section SHALL support multi-file selection for batch opening.

#### Scenario: Checkbox selection appears in open/browse modes
- **GIVEN** dialog is in "open" or "browse" mode
- **WHEN** Remote Files section is displayed
- **THEN** each file row has a checkbox for selection
- **AND** "Select All" and "Select None" buttons are visible

#### Scenario: Checkbox selection hidden in save mode
- **GIVEN** dialog is in "save" mode
- **WHEN** Remote Files section is displayed
- **THEN** file rows do not have checkboxes
- **AND** selection buttons are not visible

#### Scenario: Open Selected loads multiple files
- **GIVEN** user has selected 3 files via checkboxes
- **WHEN** user clicks "Open Selected" button
- **THEN** all 3 files are loaded into the map
- **AND** success toast shows "3 file(s) loaded"
- **AND** dialog closes

#### Scenario: Clear selection on folder navigation
- **GIVEN** user has selected files in folder "Routes"
- **WHEN** user navigates to folder "Events"
- **THEN** file selection is cleared

### Requirement: Open Selected Button Behavior

The Open Selected button SHALL provide feedback about selection count.

#### Scenario: Button shows selection count
- **GIVEN** user has selected 2 files
- **WHEN** button is displayed
- **THEN** button text shows "Open Selected (2)"

#### Scenario: Button disabled with no selection
- **GIVEN** no files are selected
- **WHEN** button is displayed
- **THEN** button shows "Open Selected" without count
- **AND** button is disabled

## MODIFIED Requirements

### Requirement: File Menu Organization

The File menu SHALL provide dedicated entries for Save As and Open Remote operations.

#### Scenario: Save As menu item
- **GIVEN** user opens File menu
- **WHEN** layers are loaded
- **THEN** "Save As..." item is visible with shortcut Ctrl+Shift+K
- **AND** clicking opens Cloud Storage in save mode

#### Scenario: Open Remote menu item
- **GIVEN** user opens File menu
- **WHEN** menu is displayed
- **THEN** "Open Remote..." item is visible with shortcut Ctrl+Shift+O
- **AND** clicking opens Cloud Storage in open mode

#### Scenario: Quick Save remains available
- **GIVEN** user opens File menu
- **WHEN** menu is displayed
- **THEN** "Quick Save to Cloud" item is visible
- **AND** it saves without opening dialog

### Requirement: View Menu Organization

The View menu SHALL include Cloud Storage for general browsing.

#### Scenario: Cloud Storage opens browse mode
- **GIVEN** user opens View menu
- **WHEN** user clicks "Cloud Storage"
- **THEN** dialog opens in browse mode

## REMOVED Requirements

### Requirement: Make Copy Button

**Reason:** Duplicates functionality provided by File > Duplicate (Ctrl+D)
**Migration:** Users should use Duplicate feature on local layers, then save

#### Scenario: Make Copy no longer available
- **GIVEN** user opens Cloud Storage dialog
- **WHEN** dialog is displayed
- **THEN** "Make Copy" button is not present
