# Tasks: Refactor run.auth Frontend to Minimal Professional Theme

## 1. Remove Decorative Components
- [x] 1.1 Delete `src/components/RainbowText.tsx`
- [x] 1.2 Delete `src/components/GlitchLabel.tsx`
- [x] 1.3 Delete `src/components/BlurPulseBackground.tsx`
- [x] 1.4 Remove bunny SVG assets from `public/logo/`

## 2. Clean Up Tailwind Configuration
- [x] 2.1 Remove `glitch-1` and `glitch-2` keyframe animations
- [x] 2.2 Remove `blurPulse` keyframe animation
- [x] 2.3 Remove rainbow color safelist

## 3. Update Theme Switch
- [x] 3.1 Remove fire mode / matrix mode easter egg
- [x] 3.2 Keep simple sun/moon toggle

## 4. Update Login Page
- [x] 4.1 Remove RainbowText from email label
- [x] 4.2 Remove GlitchLabel from invite code field
- [x] 4.3 Remove BlurPulseBackground
- [x] 4.4 Use HeroUI semantic colors for cards (`bg-content1`)
- [x] 4.5 Simplify heading to plain text

## 5. Update Dashboard Page
- [x] 5.1 Remove RainbowText from "Session" heading
- [x] 5.2 Remove BlurPulseBackground
- [x] 5.3 Use semantic colors for cards

## 6. Update Verify Page
- [x] 6.1 Ensure consistent styling with other pages

## 7. Testing and Validation
- [x] 7.1 Test dark mode appearance
- [x] 7.2 Test light mode appearance
- [x] 7.3 Run lint and build
