# Frontend Theme Specification

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Rainbow Text Effect

**Reason**: Decorative effect does not align with professional aesthetic
**Migration**: Replace with plain text using standard heading styles

### Requirement: Glitch Text Effect

**Reason**: Decorative animation does not align with professional aesthetic
**Migration**: Replace with plain text using standard text styles

### Requirement: Animated Blur Pulse Background

**Reason**: Distracting visual effect, impacts performance
**Migration**: Use solid theme background colors

### Requirement: Bunny Mascot Imagery

**Reason**: Playful branding replaced with text-based identity
**Migration**: Use text wordmark "defcon.run" in header

### Requirement: Easter Egg Modes (Fire/Matrix)

**Reason**: Hidden features add complexity without user value
**Migration**: Remove activation logic from theme switch component
