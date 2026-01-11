# frontend-theme Specification

## Purpose
TBD - created by archiving change refactor-auth-minimal-theme. Update Purpose after archive.
## Requirements
### Requirement: Minimal Professional Auth Theme
The run.auth application SHALL use a minimal, professional visual theme consistent with run.human.

#### Scenario: Login page appearance
- **GIVEN** a user visits the login page
- **WHEN** the page renders
- **THEN** form labels use plain text (no rainbow/glitch effects)
- **AND** no animated backgrounds are visible
- **AND** the card uses HeroUI semantic colors

### Requirement: Simple Theme Toggle
The theme switch component SHALL provide only light/dark mode toggle without easter egg modes.

#### Scenario: Theme switching
- **GIVEN** a user clicks the theme toggle
- **WHEN** the toggle is activated
- **THEN** the theme switches between light and dark mode
- **AND** no hidden modes (fire/matrix) are available

### Requirement: Minimal Professional Theme
The frontend applications SHALL use a minimal, professional visual theme that prioritizes readability and clean aesthetics over decorative elements.

#### Scenario: Default appearance
- **GIVEN** a user visits any page
- **WHEN** the page renders
- **THEN** the UI displays with a clean, enterprise-style appearance
- **AND** no animated backgrounds, rainbow text, or glitch effects are visible

### Requirement: Consistent Dark/Light Mode
The application SHALL support dark and light color modes using HeroUI semantic tokens.

#### Scenario: Light mode rendering
- **GIVEN** the user has selected light mode
- **WHEN** viewing any page
- **THEN** backgrounds use light colors (white/gray)
- **AND** text uses dark colors for high contrast
- **AND** all components render consistently

#### Scenario: Dark mode rendering
- **GIVEN** the user has selected dark mode
- **WHEN** viewing any page
- **THEN** backgrounds use dark colors (zinc/slate)
- **AND** text uses light colors for high contrast
- **AND** all components render consistently

### Requirement: Simple Text Logo
The header SHALL display a text-based logo instead of mascot imagery.

#### Scenario: Header logo display
- **GIVEN** the header component renders
- **WHEN** on any viewport size
- **THEN** a text wordmark "defcon.run" is displayed
- **AND** no bunny or mascot imagery appears

### Requirement: Accessible Typography
The application SHALL use accessible fonts that prioritize readability.

#### Scenario: Body text rendering
- **GIVEN** any page with body text
- **WHEN** the text renders
- **THEN** Atkinson Hyperlegible font is used for body content
- **AND** Inter font is used for headings and UI elements
- **AND** no decorative font effects (gradients, shadows, animations) are applied

