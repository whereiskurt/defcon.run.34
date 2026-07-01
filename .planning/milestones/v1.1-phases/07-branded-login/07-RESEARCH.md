# Phase 7: Branded Login - Research

**Researched:** 2026-03-02
**Domain:** Static HTML branding + Strapi SSO error page customization
**Confidence:** HIGH

## Summary

Phase 7 replaces the bare placeholder HTML at cms.defcon.run root with a DCR34-branded landing page and provides branded error pages for SSO failures. The implementation is straightforward: a static HTML file served by nginx (no JS framework, no build step) with CSS that replicates auth.defcon.run's visual identity (glass-card, dark theme, Vegas backgrounds, teal accents, MuseoModerno wordmark font).

The sign-in button links directly to the SSO OIDC endpoint with region detection via URL path parsing. Error pages are delivered by overriding `renderSignUpError` in the existing strapi-plugin-sso extension, replacing bare HTML with branded equivalents. Background images from run.auth are copied into the nginx container and served as static assets.

**Primary recommendation:** Keep this as pure static HTML + CSS served by nginx. The login page is a single `index.html` with embedded CSS and a tiny inline script for region detection. Error pages use the same visual template injected via the Strapi SSO extension. No build step, no framework, no dependencies.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Match auth.defcon.run's visual style: dark theme, glass-card centered layout, Las Vegas background images, teal accents, font-museo wordmark
- Static HTML file served by nginx (replace existing `apps/run.cms/nginx/index.html`) -- zero dependency on Strapi being up, fast, always works
- CSS embedded/inline in the HTML file
- Background images: reuse the existing Vegas background set from run.auth (`vegas-z9.png` through `vegas-z12.png`)
- Button text: "Sign in with defcon.run" -- clear SSO messaging
- Button links directly to the Strapi SSO endpoint (`/{region}/strapi-plugin-sso/oidc`) -- skips loading Strapi admin JS, fewer redirects
- Always show the sign-in button regardless of auth state -- static page has no session awareness
- Region prefix handling: detect from URL path like existing nginx patterns (e.g., `/use1/` prefix)
- All SSO errors get branded pages -- not just access denied, but token failures and network errors too
- Branded error pages use the same visual style as the login page (glass-card, Vegas background)
- Access denied message: "You don't have permission to access the CMS. Contact an event organizer to request access." (or Claude's refinement)

### Claude's Discretion
- Exact heading text and wordmark treatment
- Subtitle/tagline copy
- Logo image vs text-only wordmark
- Error page action buttons (back to login, try different account)
- Error copy for non-denial errors (token failures, etc.)
- How to override the SSO plugin's `renderSignUpError` to use branded HTML
- Background image selection and sizing

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | cms.defcon.run root shows DCR34-branded login, not raw Strapi admin form | Static HTML served by nginx at domain root; visual style extracted from auth.defcon.run CSS; Vegas backgrounds served as static nginx assets |
| AUTH-02 | Login triggers OIDC flow to auth.defcon.run with single sign-in button | Button `href` targets `/{region}/strapi-plugin-sso/oidc`; region detection via `window.location.pathname` matching; fallback to `use1` |
</phase_requirements>

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| nginx (static HTML) | latest (alpine) | Serve branded login page at domain root | Already the CMS reverse proxy; zero added dependencies |
| Google Fonts (MuseoModerno) | CDN | Wordmark font matching auth.defcon.run | Same font used by run.auth; loaded via `fonts.googleapis.com` link tag |
| Inline CSS | N/A | Glass-card, dark theme, animations | Extracted from auth's `globals.css` and `tailwind.config.js`; no build step needed |

### Supporting
| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| strapi-plugin-sso extension | existing | Override `renderSignUpError` for branded error HTML | Error pages during SSO callback failures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static HTML | Next.js/React SPA | Massive overkill for a single page with one button; adds build step, runtime dependency, bundle size |
| Inline CSS | Tailwind CDN | Adds external dependency for <100 lines of CSS; CDN availability risk |
| Google Fonts CDN | Self-hosted font files | Could self-host for zero external dependencies, but Google Fonts CDN is reliable and avoids font file management in nginx |

**Installation:**
```bash
# No npm packages needed. This is static HTML.
# Background images are copied from run.auth into the nginx build context.
cp apps/run.auth/webapp/public/bg/vegas-z10.png apps/run.cms/nginx/bg/
```

## Architecture Patterns

### File Structure
```
apps/run.cms/nginx/
  index.html          # Branded login page (replaces current placeholder)
  error.html          # Branded error page template (referenced by SSO extension)
  bg/                 # Vegas background images (copied from run.auth)
    vegas-z10.png     # Selected zoom level for CMS login
  nginx.conf          # Updated with static file serving locations
  Dockerfile.nginx    # Updated to COPY bg/ directory
```

### Pattern 1: Static HTML with Embedded CSS and Minimal JS
**What:** Single HTML file with all styles inline/embedded and a small `<script>` for region detection.
**When to use:** Simple branding pages that don't need interactivity beyond a single link/button.
**Example:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CMS - defcon.run</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=MuseoModerno:wght@400;700&display=swap" rel="stylesheet">
  <style>
    /* All CSS embedded here - glass-card, dark theme, etc. */
  </style>
</head>
<body>
  <!-- Branded content -->
  <script>
    // Region detection for SSO button href
    (function() {
      var match = window.location.pathname.match(/^\/([a-z]{3}\d)/);
      var region = match ? match[1] : 'use1';
      var btn = document.getElementById('signin-btn');
      if (btn) btn.href = '/' + region + '/strapi-plugin-sso/oidc';
    })();
  </script>
</body>
</html>
```

### Pattern 2: Nginx Static Asset Serving + Proxy Fallthrough
**What:** Add nginx locations to serve static files (HTML, images) before the proxy fallback to Strapi.
**When to use:** When nginx needs to serve both static content and proxy to an upstream.
**Example:**
```nginx
# Serve branded login page at domain root
location = / {
  root /etc/nginx/html;
  index index.html;
}

# Serve background images
location /bg/ {
  root /etc/nginx/html;
  expires 30d;
  add_header Cache-Control "public, immutable";
}

# Existing Strapi proxy fallback
location / {
  proxy_pass http://strapi_app;
  # ...
}
```

**Important:** The `location = /` (exact match) takes priority over `location /` (prefix match). This means the root URL serves static HTML while all other unprefixed paths still proxy to Strapi.

### Pattern 3: Branded Error HTML in Strapi Extension
**What:** Replace `oauthService.renderSignUpError(message)` calls with custom branded HTML in the existing strapi-server.ts extension.
**When to use:** SSO callback errors need visual branding matching the login page.
**Two approaches:**

**Approach A (Recommended): Inline branded HTML function in the extension**
```typescript
// In strapi-server.ts extension
function renderBrandedError(title: string, message: string, actions: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - defcon.run CMS</title>
  <link href="https://fonts.googleapis.com/css2?family=MuseoModerno:wght@400;700&display=swap" rel="stylesheet">
  <style>/* Same embedded CSS as login page */</style>
</head>
<body>
  <!-- Same visual structure as login page, with error content -->
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
    ${actions}
  </div>
</body>
</html>`;
}
```

**Approach B: Override the oauth service method**
```typescript
export default (plugin) => {
  // Override the service method
  const originalRenderError = plugin.services.oauth.renderSignUpError;
  plugin.services.oauth.renderSignUpError = function(message: string) {
    return renderBrandedError('Authentication Failed', message, '<a href="/">Back to Login</a>');
  };
  // ... existing controller override
  return plugin;
};
```

**Recommendation:** Use Approach A (inline function) because the existing extension already controls all `renderSignUpError` call sites in `oidcSignInCallback`. This gives finer control -- different error messages get different branded treatments (access denied vs token failure vs generic error). Approach B would also work but provides less granularity.

### Anti-Patterns to Avoid
- **Building a React SPA for the login page:** Static HTML is the right tool. The page has one button and no interactivity. React adds build complexity, bundle size, and a runtime dependency for zero benefit.
- **Inlining background images as base64:** The Vegas PNG files are 370KB-620KB each. Base64 encoding would increase size by ~33% and make the HTML file enormous. Serve them as separate static assets via nginx.
- **Making the login page depend on Strapi being up:** The whole point of nginx-served static HTML is that it works even when Strapi is down/restarting. Don't fetch anything from Strapi.
- **Hardcoding the region in the SSO URL:** The button href must be computed at page load time from `window.location.pathname`, not hardcoded to `use1`. The same HTML serves both `us-east-1` and `ca-central-1`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wordmark font | Custom font hosting/subsetting | Google Fonts CDN `MuseoModerno` | Reliable, cached, same as auth.defcon.run uses in production |
| Glass-card effect | Custom glassmorphism from scratch | Copy exact CSS from `apps/run.auth/webapp/src/styles/globals.css` | Pixel-perfect brand consistency; already battle-tested |
| Region detection | Custom URL parser | Regex pattern `window.location.pathname.match(/^\/([a-z]{3}\d)/)` | Same pattern used in `app.tsx` and throughout the codebase |

**Key insight:** This phase is about brand consistency, not invention. Every visual element already exists in auth.defcon.run. Extract, adapt, done.

## Common Pitfalls

### Pitfall 1: nginx location priority confusion
**What goes wrong:** Adding `location = /` for the static page but having it conflict with existing `location /` proxy block, or the exact match not working as expected with trailing slashes.
**Why it happens:** nginx location matching rules are non-obvious. Exact match (`=`) beats prefix (`/`), but only for the exact URI. A request to `https://cms.defcon.run/` matches `location = /`, but `https://cms.defcon.run` (no trailing slash) may not.
**How to avoid:** Use `location = /` for the exact root, and keep the existing `location /` block for proxy fallthrough. Test both with and without trailing slash.
**Warning signs:** Login page shows Strapi content instead of branded page, or Strapi admin stops loading.

### Pitfall 2: Region detection fails on root URL
**What goes wrong:** The login page is served at `https://cms.defcon.run/` (no region prefix), so the regex `match(/^\/([a-z]{3}\d)/)` returns null. The SSO button href becomes `/undefined/strapi-plugin-sso/oidc`.
**Why it happens:** The root URL has no region prefix. CloudFront routes `/{region}/*` to the regional ALB, but the root `/` may route differently.
**How to avoid:** Provide a sensible default: if no region is detected in the path, default to `use1` (primary region). The existing `app.tsx` uses the same fallback pattern.
**Warning signs:** Button click goes to 404 or wrong URL.

### Pitfall 3: Background images not found (404)
**What goes wrong:** The `<img>` or CSS `background-image` references `/bg/vegas-z10.png` but nginx has no location block serving that path, so the request falls through to Strapi which returns 404.
**Why it happens:** The Dockerfile copies images to `/etc/nginx/html/bg/` but nginx needs an explicit `location /bg/` block (or a `root` directive that covers it) to serve them.
**How to avoid:** Add a `location /bg/` block in nginx.conf that serves from `/etc/nginx/html` with caching headers.
**Warning signs:** Page loads but background is solid black, no image visible.

### Pitfall 4: CSS not matching auth.defcon.run exactly
**What goes wrong:** The branded page "looks close" but colors, blur amounts, borders, or animations are slightly off from auth.defcon.run.
**Why it happens:** Copying CSS values by eye instead of extracting exact values from the source files.
**How to avoid:** Extract exact values from these authoritative sources:
- `glass-card`: `rgba(17, 17, 24, 0.8)` background, `blur(12px)`, `1px solid #2a2a3a` border (from `globals.css`)
- `teal-dot` accent: `#00d4aa` (from `globals.css`)
- Body background: `#0a0a0f` (from `globals.css`)
- Primary color: `#00d4aa` (from `tailwind.config.js`)
- Font: `MuseoModerno` weights 400 and 700 (from `fonts.ts`)
**Warning signs:** Side-by-side comparison with auth.defcon.run shows differences.

### Pitfall 5: Error page HTML injection via error message
**What goes wrong:** The `renderSignUpError(message)` function interpolates the error message directly into HTML, creating an XSS vector if the message contains HTML/script tags.
**Why it happens:** Error messages from OIDC providers or network errors could contain angle brackets or other HTML-significant characters.
**How to avoid:** HTML-escape the error message before interpolating into the template. Use a simple function: `message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')`.
**Warning signs:** Error page renders incorrectly when error message contains special characters.

### Pitfall 6: Google Fonts CDN blocked or slow
**What goes wrong:** The MuseoModerno font doesn't load because Google Fonts CDN is blocked (corporate firewall, ad blocker) or slow, causing FOUT (flash of unstyled text) or layout shift.
**Why it happens:** External CDN dependency. The page has no fallback font specified that matches the visual weight.
**How to avoid:** Specify a fallback font stack: `font-family: 'MuseoModerno', 'Segoe UI', system-ui, sans-serif;`. Use `font-display: swap` in the Google Fonts URL to prevent invisible text.
**Warning signs:** Wordmark appears in a different font briefly before the correct font loads.

## Code Examples

### Login Page HTML Structure (verified pattern from auth.defcon.run source)
```html
<!-- Matches auth.defcon.run login page structure -->
<!-- Source: apps/run.auth/webapp/src/app/(authlogin)/login/page.tsx lines 181-189 -->
<div class="wordmark">
  <h1>defcon<span class="teal-dot">.</span>run</h1>
  <p class="subtitle">CMS</p>
</div>

<div class="glass-card">
  <div class="card-body">
    <a id="signin-btn" href="/use1/strapi-plugin-sso/oidc" class="signin-button">
      Sign in with defcon.run
    </a>
  </div>
</div>
```

### Glass Card CSS (extracted from auth.defcon.run globals.css)
```css
/* Source: apps/run.auth/webapp/src/styles/globals.css lines 38-48 */
.glass-card {
  background: rgba(17, 17, 24, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid #2a2a3a;
  border-radius: 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.glass-card:hover {
  border-color: #3a3a4a;
  box-shadow: 0 0 24px rgba(0, 212, 170, 0.06);
}
```

### Region Detection (verified pattern from app.tsx)
```javascript
// Source: apps/run.cms/app/src/admin/app.tsx lines 30-37
(function() {
  var match = window.location.pathname.match(/^\/([a-z]{3}\d)/);
  var region = match ? match[1] : 'use1';
  var btn = document.getElementById('signin-btn');
  if (btn) btn.href = '/' + region + '/strapi-plugin-sso/oidc';
})();
```

### Nginx Location for Static Root (standard nginx pattern)
```nginx
# Serve branded login page at exact root
location = / {
  root /etc/nginx/html;
  index index.html;
}

# Serve static assets (background images)
location /bg/ {
  root /etc/nginx/html;
  expires 30d;
  add_header Cache-Control "public, immutable";
}
```

### HTML Escaping for Error Messages (security pattern)
```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

### Branded Error Page in Extension (recommended approach)
```typescript
// In strapi-server.ts, replace oauthService.renderSignUpError() calls
// with custom branded HTML for each error type:

// Access denied (service claim missing)
return ctx.send(renderBrandedError(
  'Access Denied',
  "You don't have permission to access the CMS. Contact an event organizer to request access.",
  '<a href="/" class="btn">Back to Login</a>'
));

// Token/auth failure
return ctx.send(renderBrandedError(
  'Authentication Failed',
  'Something went wrong during sign-in. Please try again.',
  '<a href="/" class="btn">Try Again</a>'
));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Strapi admin customization via `admin/src/` | Strapi 5 `app.tsx` + nginx reverse proxy | Strapi 5 (2024) | Admin panel customization is limited; use nginx for pre-auth branding |
| strapi-plugin-sso renders bare HTML for errors | Extension can override `renderSignUpError` or inline custom HTML | Always available via Strapi extension API | Full control over error page HTML |

**Deprecated/outdated:**
- Strapi 4 admin customization patterns (different file structure, `app.js` not `app.tsx`)

## Open Questions

1. **Which Vegas background zoom level to use?**
   - What we know: auth.defcon.run defaults to zoom 10 ("City" view). All four levels (z9-z12) are available.
   - What's unclear: Whether the CMS login should match auth's default or use a different level.
   - Recommendation: Use `vegas-z10.png` (same default as auth.defcon.run) for brand consistency. Only copy one image to keep the nginx container small.

2. **Should the error page have a "Back to Login" link or a "Try Again" link?**
   - What we know: User said "Claude's discretion on error page action buttons"
   - What's unclear: Whether "back" means the CMS root (/) or the auth server
   - Recommendation: Use "/" (CMS root) as the back link -- it's the branded login page. For access denied, no "try again" (same account will be denied again). For generic errors, offer "Try Again" pointing to "/".

3. **CloudFront routing for the root URL `https://cms.defcon.run/`**
   - What we know: CloudFront routes `/{region}/*` to regional ALB. The root `/` must also reach nginx for the login page to be served.
   - What's unclear: Whether the current CloudFront configuration routes `/` to the ALB or has a separate behavior.
   - Recommendation: Verify during implementation that `https://cms.defcon.run/` reaches the nginx container. If it doesn't, this is an infra concern outside phase scope.

## Sources

### Primary (HIGH confidence)
- `apps/run.auth/webapp/src/styles/globals.css` - Glass-card CSS, teal-dot, noise-overlay, body background color
- `apps/run.auth/webapp/tailwind.config.js` - Color palette (#00d4aa primary, #0a0a0f background), animation keyframes
- `apps/run.auth/webapp/src/config/fonts.ts` - MuseoModerno font configuration (weights 400, 700)
- `apps/run.auth/webapp/src/components/map-background.tsx` - Background image rendering pattern (z9-z12 PNGs, brightness/contrast filters)
- `apps/run.auth/webapp/src/app/(authlogin)/login/page.tsx` - Login page structure (wordmark, glass-card, button layout)
- `apps/run.cms/nginx/nginx.conf` - Current nginx configuration, location block patterns, region prefix handling
- `apps/run.cms/nginx/Dockerfile.nginx` - Current nginx Dockerfile, file copy patterns
- `apps/run.cms/nginx/index.html` - Current placeholder (10 lines bare HTML, to be replaced)
- `apps/run.cms/app/src/extensions/strapi-plugin-sso/strapi-server.ts` - SSO extension, `renderSignUpError` call sites
- `apps/run.cms/app/src/admin/app.tsx` - Region detection pattern, SSO URL construction
- `apps/run.cms/app/node_modules/strapi-plugin-sso/dist/server/index.js` - Default `renderSignUpError` implementation (bare HTML)

### Secondary (MEDIUM confidence)
- [Google Fonts MuseoModerno](https://fonts.google.com/specimen/MuseoModerno) - CDN availability confirmed

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components already exist in the codebase; this is extraction and adaptation, not new technology
- Architecture: HIGH - nginx static file serving is well-understood; Strapi extension pattern is already proven in this codebase
- Pitfalls: HIGH - All pitfalls identified from reading the actual codebase files; no speculative risks

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- no moving parts; all dependencies are pinned or static)
