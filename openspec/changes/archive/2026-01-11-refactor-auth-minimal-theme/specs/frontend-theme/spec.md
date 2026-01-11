# Frontend Theme Specification (run.auth)

## ADDED Requirements

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
