# frontend-theme Specification

## Purpose
Visual theme and styling conventions for the defcon.run Next.js frontend applications (run.auth, run.human). Uses HeroUI component library with Tailwind CSS, supporting dark/light modes with a clean, minimal aesthetic.

## Requirements

### Requirement: HeroUI + Tailwind CSS Foundation
The frontend applications SHALL use HeroUI component library with Tailwind CSS for styling.

#### Scenario: Component rendering
- **GIVEN** a frontend page renders
- **WHEN** UI components are displayed
- **THEN** they use HeroUI semantic components and Tailwind utility classes
- **AND** the `heroui()` plugin is configured in `tailwind.config.js`

### Requirement: Dark/Light Mode Toggle
The application SHALL support dark and light color modes via a simple toggle with no hidden modes.

#### Scenario: Theme switching
- **GIVEN** a user clicks the theme toggle
- **WHEN** the toggle is activated
- **THEN** the theme switches between light and dark mode only
- **AND** no easter egg modes (fire, matrix, etc.) are available

#### Scenario: Dark mode rendering
- **GIVEN** dark mode is selected
- **WHEN** viewing any page
- **THEN** backgrounds use dark colors and text uses light colors for high contrast

#### Scenario: Light mode rendering
- **GIVEN** light mode is selected
- **WHEN** viewing any page
- **THEN** backgrounds use light colors and text uses dark colors for high contrast

### Requirement: Minimal Professional Aesthetic
The frontend SHALL use a clean, professional visual theme without decorative effects.

#### Scenario: Default appearance
- **GIVEN** a user visits any page
- **WHEN** the page renders
- **THEN** no animated backgrounds, rainbow text, or glitch effects are visible
- **AND** form labels use plain text
- **AND** HeroUI semantic colors are used

### Requirement: Text Wordmark Logo
The header SHALL display a text-based "defcon.run" wordmark instead of mascot imagery.

#### Scenario: Header logo display
- **GIVEN** the header component renders
- **WHEN** on any viewport size
- **THEN** a text wordmark "defcon.run" is displayed

### Requirement: Accessible Typography
The application SHALL use accessible fonts that prioritize readability.

#### Scenario: Font rendering
- **GIVEN** any page with content
- **WHEN** text renders
- **THEN** Inter is the primary sans-serif font (via `--font-sans`)
- **AND** Atkinson Hyperlegible is available for body content
- **AND** Fira Code is used for monospaced content
- **AND** Lato and MuseoModerno are available for accent use

## Implementation Notes

- Tailwind config: `apps/run.{auth,human}/webapp/tailwind.config.js`
- Font definitions: `apps/run.{auth,human}/webapp/src/config/fonts.ts`
- Theme switch component: `apps/run.human/webapp/src/components/theme-switch.tsx`
- Provider setup: `apps/run.human/webapp/src/app/providers.tsx` (HeroUIProvider + NextThemesProvider)
- Global CSS: `apps/run.human/webapp/src/styles/globals.css` (Tailwind 4 `@import "tailwindcss"`)
- Dark mode strategy: `class` (via `darkMode: 'class'` in Tailwind config)
