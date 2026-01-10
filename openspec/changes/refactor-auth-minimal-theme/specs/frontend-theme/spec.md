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

## REMOVED Requirements

### Requirement: Rainbow Text on Form Labels
**Reason**: Decorative effect distracts from form usability
**Migration**: Use plain text labels

### Requirement: Glitch Text Effect on Invite Code
**Reason**: Animation unnecessary for professional auth flow
**Migration**: Use plain text label

### Requirement: Animated Blur Pulse Background
**Reason**: Distracting, impacts performance
**Migration**: Use solid theme background

### Requirement: Easter Egg Modes
**Reason**: Hidden features add complexity
**Migration**: Remove from theme switch
