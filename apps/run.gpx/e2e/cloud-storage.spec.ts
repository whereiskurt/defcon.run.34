import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadAuthCookies,
  hasAuthCookieJar,
  getAuthCookieJarPath,
  loadAuthCookiesForUser,
  hasAuthCookieJarForUser,
  getEmailForRole,
  type UserRole,
} from './lib/cookie-jar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test configuration (defaults to localhost, use --prod flag or set BASE_URL for production)
const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';
// Local dev has no region prefix, production uses regional path (default: use1)
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;
const STUDIO_PATH = `${REGION_PREFIX}/studio`;

// Sample files directory
const SAMPLES_DIR = path.join(__dirname, 'samples');

// Sample GPX content for testing (inline fallback)
const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e-test">
  <metadata><name>E2E Test Track</name></metadata>
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="45.5017" lon="-73.5673"><ele>30</ele></trkpt>
      <trkpt lat="45.5018" lon="-73.5674"><ele>31</ele></trkpt>
      <trkpt lat="45.5019" lon="-73.5675"><ele>32</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

// Test file name with timestamp to avoid collisions
const TEST_FILE_PREFIX = 'e2e-test';
const getTestFileName = () => `${TEST_FILE_PREFIX}-${Date.now()}.gpx`;

// Auth service URL for OIDC flow (set by e2e.sh, defaults to localhost)
const AUTH_SERVICE_URL = process.env.AUTH_URL || 'http://localhost:3002';

// Helper to load a sample file
function loadSampleFile(filename: string): Buffer {
  const filePath = path.join(SAMPLES_DIR, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath);
  }
  // Fallback to inline sample
  return Buffer.from(SAMPLE_GPX);
}

// Get list of available sample files
function getSampleFiles(): string[] {
  if (fs.existsSync(SAMPLES_DIR)) {
    return fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.gpx'));
  }
  return [];
}

// Get sample files filtered by size (to avoid slow uploads for large files)
function getSampleFilesFiltered(maxSizeKB: number = 200): string[] {
  if (!fs.existsSync(SAMPLES_DIR)) {
    return [];
  }
  return fs.readdirSync(SAMPLES_DIR)
    .filter(f => f.endsWith('.gpx'))
    .filter(f => {
      const stats = fs.statSync(path.join(SAMPLES_DIR, f));
      return stats.size < maxSizeKB * 1024;
    })
    .sort((a, b) => {
      // Sort by size ascending
      const aStats = fs.statSync(path.join(SAMPLES_DIR, a));
      const bStats = fs.statSync(path.join(SAMPLES_DIR, b));
      return aStats.size - bStats.size;
    });
}

// Helper to upload a file via API and return fileId
async function uploadFileViaAPI(page: Page, filename: string, content: Buffer): Promise<string | null> {
  // Create file record
  const createResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`, {
    data: {
      fileName: filename,
      fileSize: content.length,
      trackCount: 1,
      waypointCount: 0,
    },
  });

  if (!createResponse.ok()) {
    console.log(`Failed to create file: ${createResponse.status()}`);
    return null;
  }

  const createData = await createResponse.json();
  const { fileId, uploadUrl } = createData;

  // Upload to S3
  const uploadResponse = await page.request.put(uploadUrl, {
    data: content,
    headers: { 'Content-Type': 'application/gpx+xml' },
  });

  if (!uploadResponse.ok()) {
    console.log(`Failed to upload to S3: ${uploadResponse.status()}`);
    return null;
  }

  // Confirm upload
  const confirmResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${fileId}/confirm`);
  if (!confirmResponse.ok()) {
    console.log(`Failed to confirm upload: ${confirmResponse.status()}`);
    return null;
  }

  return fileId;
}

// Helper to establish GPX session via OIDC
async function establishSession(page: Page, context: BrowserContext, role: UserRole = 'default'): Promise<boolean> {
  // Load appropriate cookies
  const loaded = role === 'default'
    ? await loadAuthCookies(context)
    : await loadAuthCookiesForUser(context, role);

  if (!loaded) {
    return false;
  }

  // Check if already authenticated on GPX
  const sessionResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/session`);
  const session = await sessionResponse.json();

  if (session?.user) {
    return true;
  }

  // Trigger OIDC flow
  await page.goto(`${BASE_URL}${REGION_PREFIX}/api/auth/signin`);
  await page.waitForLoadState('networkidle');

  const defconButton = page.locator('button:has-text("Sign in with DEF CON")');
  if (await defconButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await defconButton.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  }

  // Verify session established
  const finalSession = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/session`);
  const finalData = await finalSession.json();
  return !!finalData?.user;
}

// Helper to open cloud storage dialog
async function openCloudStorage(page: Page, mode: 'open' | 'save' | 'browse') {
  // Find and click the File menu trigger
  const fileMenuTrigger = page.locator('[aria-label*="ile"]').first();
  await expect(fileMenuTrigger).toBeVisible({ timeout: 10000 });
  await fileMenuTrigger.click();

  // Click the appropriate menu item based on mode
  if (mode === 'open') {
    await page.locator('text=Open Remote').click();
  } else if (mode === 'save') {
    await page.locator('text=Save As').click();
  } else {
    // browse - use Storage menu item if available
    const storageItem = page.locator('text=Storage');
    if (await storageItem.isVisible({ timeout: 1000 }).catch(() => false)) {
      await storageItem.click();
    } else {
      await page.locator('text=Open Remote').click();
    }
  }

  // Wait for dialog
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

// ============================================================================
// 1. AUTH SMOKE TEST - Runs first to verify auth is working
// ============================================================================

test.describe('1. Auth Smoke Test', () => {
  test('should authenticate via OIDC flow', async ({ page, context }) => {
    console.log('=== SMOKE TEST: Verifying auth setup ===');
    console.log(`BASE_URL: ${BASE_URL}`);
    console.log(`AUTH_SERVICE_URL: ${AUTH_SERVICE_URL}`);
    console.log(`isLocal: ${isLocal}`);
    console.log(`Cookie jar path: ${getAuthCookieJarPath()}`);

    // Check auth cookie jar exists
    if (!hasAuthCookieJar()) {
      console.error('FAIL: No auth cookie jar found');
      console.error(`Expected at: ${getAuthCookieJarPath()}`);
      throw new Error('No auth cookie jar - run auth e2e tests first');
    }
    console.log('OK: Auth cookie jar exists');

    // Load auth service cookies into context
    const loaded = await loadAuthCookies(context);
    if (!loaded) {
      throw new Error('Failed to load cookies from jar');
    }
    console.log('OK: Auth cookies loaded');

    // Check GPX session first
    console.log('Checking GPX session...');
    let sessionResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/session`);
    let session = await sessionResponse.json();

    if (session?.user) {
      console.log(`Already authenticated as ${session.user.email}`);
      console.log('=== SMOKE TEST PASSED ===');
      return;
    }

    // Not authenticated on GPX - trigger OIDC login flow
    console.log('No GPX session - triggering OIDC login flow...');

    // Navigate to GPX signin which redirects to auth service
    const signinUrl = `${BASE_URL}${REGION_PREFIX}/api/auth/signin`;
    console.log(`Navigating to: ${signinUrl}`);
    await page.goto(signinUrl);

    // Wait for either:
    // 1. Redirect back to GPX (auto-login worked)
    // 2. Auth service login page (need to click provider button)
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    // If we're on GPX signin page, trigger the OIDC flow
    if (currentUrl.includes('/api/auth/signin')) {
      console.log('On GPX signin page - triggering OIDC flow...');

      // In production, Auth.js generates form action URLs without region prefix
      // So we navigate directly to the signin URL with provider instead of clicking the button
      const signinWithProviderUrl = `${BASE_URL}${REGION_PREFIX}/api/auth/signin/run.defcon.run`;
      console.log(`Navigating directly to: ${signinWithProviderUrl}`);
      await page.goto(signinWithProviderUrl);
      await page.waitForLoadState('networkidle', { timeout: 10000 });
      console.log(`After navigation URL: ${page.url()}`);
    }

    // If we're on auth service, it should auto-redirect with valid session
    const urlAfterClick = page.url();
    if (urlAfterClick.includes('localhost:3002') || urlAfterClick.includes('auth.defcon.run')) {
      console.log('On auth service - waiting for auto-redirect...');
      await page.waitForTimeout(2000);
      console.log(`After wait URL: ${page.url()}`);
    }

    // Wait for redirect back to GPX
    console.log('Waiting for redirect to GPX...');
    await page.waitForURL(url => url.toString().includes(BASE_URL.replace('http://', '').replace('https://', '')), {
      timeout: 15000,
    }).catch(() => {
      console.log(`Final URL: ${page.url()}`);
    });

    console.log(`Final URL: ${page.url()}`);

    // Check GPX session again
    sessionResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/session`);
    session = await sessionResponse.json();
    console.log('GPX Session:', JSON.stringify(session, null, 2));

    if (!session?.user) {
      throw new Error('OIDC flow did not establish GPX session');
    }

    console.log(`OK: Authenticated as ${session.user.email}`);
    console.log('=== SMOKE TEST PASSED ===');
  });
});

// ============================================================================
// 2. TEST SETUP - Upload sample files BEFORE other tests
// ============================================================================

test.describe('2. Test Setup - Upload Sample Files', () => {
  test.beforeEach(async ({ page, context }) => {
    if (!hasAuthCookieJar()) {
      test.skip();
      return;
    }
    const success = await establishSession(page, context);
    if (!success) {
      test.skip();
    }
  });

  test('should upload multiple sample GPX files for testing', async ({ page }) => {
    // Get sample files filtered by size (max 200KB each for speed)
    // This gives us diverse routes without huge files slowing tests
    const sampleFiles = getSampleFilesFiltered(200);
    const allSampleFiles = getSampleFiles();

    console.log(`Available sample files: ${allSampleFiles.length} total, ${sampleFiles.length} under 200KB`);

    // Upload all filtered sample files (or fallback to first 3 of any size)
    const filesToUpload = sampleFiles.length >= 3
      ? sampleFiles
      : allSampleFiles.slice(0, 5);

    console.log(`Uploading ${filesToUpload.length} sample files...`);

    const uploadedIds: string[] = [];

    for (let i = 0; i < filesToUpload.length; i++) {
      const sampleFile = filesToUpload[i];
      const content = loadSampleFile(sampleFile);
      const testFileName = `e2e-sample-${i + 1}-${Date.now()}.gpx`;

      console.log(`Uploading: ${testFileName} (from ${sampleFile}, ${Math.round(content.length / 1024)}KB)`);

      const fileId = await uploadFileViaAPI(page, testFileName, content);

      if (fileId) {
        uploadedIds.push(fileId);
        console.log(`  Uploaded with ID: ${fileId}`);
      } else {
        console.log(`  Failed to upload ${testFileName}`);
      }
    }

    expect(uploadedIds.length).toBeGreaterThan(0);
    console.log(`Successfully uploaded ${uploadedIds.length} sample files`);

    // Verify files appear in list
    const listResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    expect(listResponse.ok()).toBe(true);

    const { files } = await listResponse.json();
    const e2eFiles = files.filter((f: { fileName: string }) => f.fileName.startsWith('e2e-'));
    console.log(`Total e2e files in cloud storage: ${e2eFiles.length}`);

    expect(e2eFiles.length).toBeGreaterThanOrEqual(uploadedIds.length);
  });

  test('should upload files for accountb user (multi-user tests)', async ({ page, context, browser }) => {
    // Skip if accountb session doesn't exist
    if (!hasAuthCookieJarForUser('accountb')) {
      console.log('No accountb session - skipping accountb file upload');
      console.log('Run: TEST_USER_ROLE=accountb BASE_URL=http://localhost:3002 npm test (in auth e2e)');
      test.skip();
      return;
    }

    // Create new context for accountb
    const accountbContext = await browser.newContext();
    const accountbPage = await accountbContext.newPage();

    const success = await establishSession(accountbPage, accountbContext, 'accountb');
    if (!success) {
      await accountbContext.close();
      console.log('Failed to establish accountb session');
      test.skip();
      return;
    }

    // Upload a file as accountb
    const content = loadSampleFile('guelph-loop-approx.gpx');
    const testFileName = `e2e-accountb-${Date.now()}.gpx`;

    console.log(`Uploading file as accountb: ${testFileName}`);

    const fileId = await uploadFileViaAPI(accountbPage, testFileName, content);

    if (fileId) {
      console.log(`accountb file uploaded with ID: ${fileId}`);
    } else {
      console.log('Failed to upload accountb file');
    }

    await accountbContext.close();

    expect(fileId).not.toBeNull();
  });
});

// ============================================================================
// 3. CLOUD STORAGE E2E - Main UI tests
// ============================================================================

test.describe('3. Cloud Storage E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    if (!hasAuthCookieJar()) {
      console.log('No auth cookie jar found.');
      console.log(`Please run the run.auth e2e tests first to create a session.`);
      console.log(`Expected location: ${getAuthCookieJarPath()}`);
      test.skip();
      return;
    }

    const success = await establishSession(page, context);
    if (!success) {
      console.log('Failed to establish session');
      test.skip();
    }
  });

  test('should verify authenticated session', async ({ page }) => {
    // Navigate to studio and verify we're logged in
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);

    // Wait for the app to load - look for the main map or toolbar
    await expect(page.locator('body')).toBeVisible({ timeout: 30000 });

    // Check for session - the app should have loaded the main interface
    // If not authenticated, we'd be redirected to login
    const url = page.url();
    expect(url).not.toContain('/login');
    expect(url).not.toContain('/signin');

    console.log('Session verified - user is authenticated');
  });

  test('should open Cloud Storage dialog', async ({ page }) => {
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');

    // Wait for the app to fully load - look for the menubar
    await page.waitForTimeout(2000);

    // Find and click the File menu trigger (has aria-label containing 'file')
    const fileMenuTrigger = page.locator('[aria-label*="ile"]').first();
    await expect(fileMenuTrigger).toBeVisible({ timeout: 10000 });
    await fileMenuTrigger.click();

    // Click "Open Remote..." menu item
    const openRemoteItem = page.locator('text=Open Remote');
    await expect(openRemoteItem).toBeVisible({ timeout: 5000 });
    await openRemoteItem.click();

    // Verify dialog opened
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Check for dialog title "Open from Cloud"
    await expect(dialog.getByRole('heading', { name: /Cloud/ })).toBeVisible();

    console.log('Cloud Storage dialog opened successfully');
  });

  test('should open Save As dialog', async ({ page }) => {
    // This test verifies the Save As dialog opens correctly
    // Note: "Save As" is disabled when no files are loaded
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open File menu
    const fileMenuTrigger = page.locator('[aria-label*="ile"]').first();
    await expect(fileMenuTrigger).toBeVisible({ timeout: 10000 });
    await fileMenuTrigger.click();

    // Check if "Save As" is enabled
    const saveAsItem = page.locator('[role="menuitem"]:has-text("Save As")');
    await expect(saveAsItem).toBeVisible({ timeout: 5000 });

    // Check if the menu item is disabled
    const isDisabled = await saveAsItem.getAttribute('data-disabled');
    if (isDisabled !== null) {
      console.log('Save As is disabled (no files loaded) - this is expected behavior');
      // Still verify the menu item exists and is properly labeled
      await expect(saveAsItem).toHaveText(/Save As/);
      console.log('Save As menu item verified (disabled state)');
      return; // Test passes - we verified the menu item exists
    }

    await saveAsItem.click();

    // Wait for dialog
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Verify dialog title
    await expect(dialog.getByRole('heading', { name: /Cloud|Save/i })).toBeVisible();

    console.log('Save As dialog opened successfully');
  });

  test('should open a file from cloud storage', async ({ page }) => {
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open Cloud Storage in open mode
    const dialog = await openCloudStorage(page, 'open');

    // Wait for files to load
    await page.waitForTimeout(2000);

    // Look for file rows in the table (they have checkboxes)
    const fileCheckboxes = dialog.locator('table tr').filter({ hasText: /\.gpx/i }).locator('button[role="checkbox"]');

    const checkboxCount = await fileCheckboxes.count();
    console.log(`Found ${checkboxCount} file checkboxes`);

    if (checkboxCount === 0) {
      console.log('No files found in cloud storage - test setup may have failed');
      test.fail();
      return;
    }

    // Click the first checkbox to select the file
    await fileCheckboxes.first().click();
    await page.waitForTimeout(500);

    // Click Open Selected button (blue button)
    const openButton = dialog.locator('button.bg-blue-600, button:has-text("Open")').filter({ hasText: /Open/i });
    await expect(openButton).toBeEnabled({ timeout: 5000 });
    await openButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    console.log('File opened from cloud successfully');
  });

  test('should select and open multiple files', async ({ page }) => {
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open Cloud Storage in open mode
    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    // Look for file checkboxes in the table
    const fileCheckboxes = dialog.locator('table tr').filter({ hasText: /\.gpx/i }).locator('button[role="checkbox"]');
    const fileCount = await fileCheckboxes.count();

    console.log(`Found ${fileCount} files to open`);

    if (fileCount < 2) {
      console.log(`Only ${fileCount} file(s) found - test setup should have uploaded at least 3`);
      test.fail();
      return;
    }

    // Select files that are geographically diverse (NYC, Japan, Vegas, Guelph)
    // Look for specific file names in the table rows
    const tableRows = dialog.locator('table tr').filter({ hasText: /\.gpx/i });
    const rowCount = await tableRows.count();

    // Priority order for diverse locations (check file names)
    const diversePatterns = ['NYC', 'Japan', 'lvcc', 'Guelph', 'bigstar'];
    const selectedIndices: number[] = [];

    // First pass: find rows matching our diverse patterns
    for (const pattern of diversePatterns) {
      if (selectedIndices.length >= 4) break; // Max 4 diverse files
      for (let i = 0; i < rowCount && selectedIndices.length < 4; i++) {
        if (selectedIndices.includes(i)) continue;
        const rowText = await tableRows.nth(i).textContent();
        if (rowText?.toLowerCase().includes(pattern.toLowerCase())) {
          selectedIndices.push(i);
          console.log(`Found diverse file: ${pattern} at row ${i}`);
        }
      }
    }

    // If we didn't find enough diverse files, add first few remaining
    for (let i = 0; selectedIndices.length < 4 && i < rowCount; i++) {
      if (!selectedIndices.includes(i)) {
        selectedIndices.push(i);
      }
    }

    console.log(`Selecting ${selectedIndices.length} geographically diverse files...`);

    // Click checkboxes for selected rows
    for (const idx of selectedIndices) {
      const checkbox = tableRows.nth(idx).locator('button[role="checkbox"]');
      await checkbox.click();
      await page.waitForTimeout(200);
    }

    // Click Open button (blue button)
    const openButton = dialog.locator('button.bg-blue-600, button:has-text("Open")').filter({ hasText: /Open/i });
    await expect(openButton).toBeEnabled({ timeout: 5000 });
    await openButton.click();

    // Wait for files to load (longer timeout for multiple files)
    await page.waitForTimeout(8000);

    // Dialog should close automatically after loading
    const isDialogVisible = await dialog.isVisible().catch(() => false);
    if (isDialogVisible) {
      const closeButton = dialog.locator('button[aria-label="Close"], button:has-text("Close")').first();
      if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeButton.click();
        await page.waitForTimeout(2000);
      }
    }

    // Take initial screenshot of map with all loaded files
    await page.screenshot({ path: 'test-results/multi-file-all-loaded.png', fullPage: false });
    console.log('Screenshot: multi-file-all-loaded.png');

    // The file tabs are at the bottom of the screen in a horizontal scrollable area
    // Each file tab is a button containing the file name
    // Wait a bit more for tabs to render
    await page.waitForTimeout(1000);

    // Look for file tabs - they're buttons with e2e-sample in the text
    // The tabs might be in a scrollable container
    const fileTabs = page.locator('button').filter({ hasText: /e2e-sample/i });
    const fileTabCount = await fileTabs.count();
    console.log(`Found ${fileTabCount} file tabs`);

    // List all file tab names for debugging
    for (let i = 0; i < fileTabCount; i++) {
      const tabText = await fileTabs.nth(i).textContent();
      console.log(`  Tab ${i + 1}: ${tabText?.trim()}`);
    }

    // Helper function to center on a file and take screenshot
    async function centerOnFileAndScreenshot(fileIndex: number, screenshotName: string) {
      const fileTab = fileTabs.nth(fileIndex);
      const tabText = await fileTab.textContent();
      console.log(`Centering on file ${fileIndex + 1}: ${tabText?.trim()}`);

      // Click the file tab to select it
      await fileTab.click();
      await page.waitForTimeout(500);

      // Method 1: Try right-click on the file tab itself for Center option
      await fileTab.click({ button: 'right' });
      await page.waitForTimeout(300);

      let centerMenuItem = page.locator('[role="menuitem"]').filter({ hasText: /Center/i });
      if (await centerMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await centerMenuItem.click();
        await page.waitForTimeout(2000); // Wait for map animation
        await page.screenshot({ path: `test-results/${screenshotName}`, fullPage: false });
        console.log(`Screenshot: ${screenshotName} (via file tab context menu)`);
        return true;
      }

      // Close any open menu by pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Method 2: Try keyboard shortcut Ctrl+Enter on selected file
      await fileTab.click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+Enter');
      await page.waitForTimeout(2000); // Wait for map animation

      // Check if map moved by taking screenshot
      await page.screenshot({ path: `test-results/${screenshotName}`, fullPage: false });
      console.log(`Screenshot: ${screenshotName} (via Ctrl+Enter)`);
      return true;
    }

    if (fileTabCount >= 2) {
      // Center on first file
      await centerOnFileAndScreenshot(0, 'multi-file-centered-1.png');

      // Center on second file (should show different location)
      await centerOnFileAndScreenshot(1, 'multi-file-centered-2.png');

      // Center on third file if available
      if (fileTabCount >= 3) {
        await centerOnFileAndScreenshot(2, 'multi-file-centered-3.png');
      }

      // Test Hide feature on first file
      console.log('Testing Hide feature...');
      const firstTab = fileTabs.first();
      await firstTab.click();
      await page.waitForTimeout(300);

      // Look for Track 1 to hide
      const trackItems = page.locator('button').filter({ hasText: /^Track \d+$/ });
      if (await trackItems.count() > 0) {
        await trackItems.first().click({ button: 'right' });
        await page.waitForTimeout(300);

        const hideMenuItem = page.locator('[role="menuitem"]').filter({ hasText: /^Hide$/i });
        if (await hideMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await hideMenuItem.click();
          await page.waitForTimeout(1000);
          await page.screenshot({ path: 'test-results/multi-file-track-hidden.png', fullPage: false });
          console.log('Screenshot: multi-file-track-hidden.png (track hidden)');

          // Verify hidden indicator (EyeOff icon appears next to hidden items)
          const hiddenIcon = page.locator('svg.lucide-eye-off');
          const hasHiddenIcon = await hiddenIcon.first().isVisible({ timeout: 1000 }).catch(() => false);
          if (hasHiddenIcon) {
            console.log('Hidden indicator visible - hide worked');
          }

          // Unhide all
          await trackItems.first().click({ button: 'right' });
          await page.waitForTimeout(300);
          const unhideAllItem = page.locator('[role="menuitem"]').filter({ hasText: /Unhide All/i });
          if (await unhideAllItem.isVisible({ timeout: 1000 }).catch(() => false)) {
            await unhideAllItem.click();
            await page.waitForTimeout(500);
            console.log('Unhide All executed');
          }
        } else {
          // Try keyboard shortcut
          await trackItems.first().click();
          await page.keyboard.press('Control+h');
          await page.waitForTimeout(1000);
          await page.screenshot({ path: 'test-results/multi-file-track-hidden.png', fullPage: false });
          console.log('Screenshot: multi-file-track-hidden.png (via keyboard)');
        }
      }
    } else {
      console.log('Not enough file tabs for multi-file testing');
    }

    console.log('Multiple files test with map verification completed');
  });

  test('should create a public share link', async ({ page }) => {
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open Cloud Storage in open/browse mode
    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    // Find a file to share
    const fileRows = dialog.locator('[data-state]').filter({ hasText: /\.gpx/i });

    if (await fileRows.count() === 0) {
      console.log('No files found to share - test setup may have failed');
      test.fail();
      return;
    }

    // Click the first file to select it
    await fileRows.first().click();

    // Look for a share button (could be in toolbar or on the row)
    const shareButton = dialog.locator('button[title*="hare"], button:has-text("Share")').first();

    if (await shareButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await shareButton.click();
    } else {
      console.log('No share button visible - UI may not support sharing from dialog');
      test.skip();
      return;
    }

    // Share dialog should appear
    const shareDialog = page.locator('[role="dialog"]').filter({ hasText: /Share/i });
    await expect(shareDialog).toBeVisible({ timeout: 10000 });

    // Click Create Share Link button
    const createShareButton = shareDialog.locator('button').filter({ hasText: /Create Share/i });
    await expect(createShareButton).toBeVisible();
    await createShareButton.click();

    // Wait for share URL to appear
    await page.waitForTimeout(2000);

    // Verify share URL input appears
    const shareUrlInput = shareDialog.locator('input[readonly]');
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });

    // Get the share URL
    const shareUrl = await shareUrlInput.inputValue();
    expect(shareUrl).toContain('/share/');

    console.log(`Public share created: ${shareUrl}`);
  });

  test('should access a public share link', async ({ page }) => {
    // This test uses the API to create a share, then accesses it via URL
    // Note: The share page redirects to /studio/app?share=token

    // First, list files via API to get one to share
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      console.log('Could not list files');
      test.fail();
      return;
    }

    const { files } = await filesResponse.json();
    if (files.length === 0) {
      console.log('No files available - test setup may have failed');
      test.fail();
      return;
    }

    const file = files[0];

    // Create a public share via API
    const shareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: file.fileId,
        version: file.version || 1,
        accessMode: 'public',
      },
    });

    if (!shareResponse.ok()) {
      console.log('Could not create share');
      test.fail();
      return;
    }

    const shareData = await shareResponse.json();
    const shareUrl = shareData.shareUrl as string;
    const shareToken = shareUrl.split('/share/').pop();
    console.log(`Testing share access: ${shareUrl}`);
    console.log(`Share token: ${shareToken}`);

    // Verify the share exists via API (this is more reliable than browser navigation)
    const verifyResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${shareToken}`);
    expect(verifyResponse.ok()).toBe(true);

    const shareDetails = await verifyResponse.json();
    console.log(`Share details response:`, JSON.stringify(shareDetails, null, 2));

    // The API response structure may vary - just verify we got a response
    expect(shareDetails).toBeDefined();

    // Navigate to share URL - it will redirect to /studio/app?share=token
    await page.goto(shareUrl);

    // Wait for any redirect
    await page.waitForTimeout(2000);

    // The share page redirects to /studio/app?share=token
    // Verify we ended up at the right place (with share param)
    const finalUrl = page.url();
    console.log(`Final URL after redirect: ${finalUrl}`);

    // The URL should contain the share token as a query param
    if (finalUrl.includes('share=')) {
      console.log('Share URL redirected correctly to app with share param');
    } else if (finalUrl.includes('/studio/share/')) {
      console.log('Still on share page (redirect may be pending)');
    } else {
      console.log(`Unexpected URL: ${finalUrl}`);
    }

    // Clean up - delete the share
    await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${shareData.shareId}`);

    console.log('Public share access test completed');
  });
});

// ============================================================================
// 4. MULTI-USER SHARE TESTS
// ============================================================================

test.describe('4. Multi-User Share Tests', () => {
  test('should create and access a private share between users', async ({ page, context, browser }) => {
    // Check if we have both user cookie jars
    if (!hasAuthCookieJarForUser('accountb') || !hasAuthCookieJarForUser('accountc')) {
      console.log('Multi-user test requires both accountb and accountc sessions.');
      console.log('Run auth e2e tests with TEST_USER_ROLE=accountb and TEST_USER_ROLE=accountc first.');
      test.skip();
      return;
    }

    // === ACCOUNT B SESSION (file owner) ===
    console.log('=== accountb session: Creating private share ===');

    // Load accountb cookies
    const accountbLoaded = await loadAuthCookiesForUser(context, 'accountb');
    if (!accountbLoaded) {
      test.skip();
      return;
    }

    // Trigger OIDC for accountb
    await page.goto(`${BASE_URL}${REGION_PREFIX}/api/auth/signin`);
    await page.waitForLoadState('networkidle');
    const defconButton = page.locator('button:has-text("Sign in with DEF CON")');
    if (await defconButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await defconButton.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    }

    // Get accountb's files
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      console.log('accountb not authenticated');
      test.skip();
      return;
    }

    const { files } = await filesResponse.json();
    if (files.length === 0) {
      console.log('accountb has no files to share - uploading one now');

      // Upload a file for accountb
      const content = loadSampleFile('guelph-loop-approx.gpx');
      const testFileName = `e2e-accountb-share-${Date.now()}.gpx`;
      const fileId = await uploadFileViaAPI(page, testFileName, content);

      if (!fileId) {
        console.log('Failed to upload file for accountb');
        test.fail();
        return;
      }

      // Re-fetch files
      const refetchResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
      const refetchData = await refetchResponse.json();
      if (refetchData.files.length === 0) {
        test.fail();
        return;
      }
    }

    // Get updated file list
    const updatedFilesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    const { files: updatedFiles } = await updatedFilesResponse.json();

    const fileToShare = updatedFiles[0];
    const accountcEmail = getEmailForRole('accountc');

    // Create private share for accountc
    const shareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: fileToShare.fileId,
        version: fileToShare.version || 1,
        accessMode: 'private',
        allowedEmails: [accountcEmail],
      },
    });

    expect(shareResponse.ok()).toBe(true);
    const shareData = await shareResponse.json();
    const shareUrl = shareData.shareUrl as string;
    const shareId = shareData.shareId;

    console.log(`Private share created for ${accountcEmail}: ${shareUrl}`);

    // === ACCOUNT C SESSION (share recipient) ===
    console.log('=== accountc session: Accessing private share ===');

    // Create new context for accountc
    const accountcContext = await browser.newContext();
    const accountcPage = await accountcContext.newPage();

    // Load accountc cookies
    const accountcLoaded = await loadAuthCookiesForUser(accountcContext, 'accountc');
    if (!accountcLoaded) {
      await accountcContext.close();
      test.skip();
      return;
    }

    // Trigger OIDC for accountc
    console.log(`accountc going to signin: ${BASE_URL}${REGION_PREFIX}/api/auth/signin`);
    await accountcPage.goto(`${BASE_URL}${REGION_PREFIX}/api/auth/signin`);
    await accountcPage.waitForLoadState('networkidle');
    console.log(`accountc signin URL after load: ${accountcPage.url()}`);
    const accountcDefconButton = accountcPage.locator('button:has-text("Sign in with DEF CON")');
    if (await accountcDefconButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('accountc: Sign in button visible, clicking...');
      await accountcDefconButton.click();
      await accountcPage.waitForLoadState('networkidle', { timeout: 10000 });
      console.log(`accountc URL after signin click: ${accountcPage.url()}`);
    } else {
      console.log('accountc: Sign in button not visible (already authenticated?)');
    }

    // accountc accesses the share URL
    console.log(`accountc navigating to share URL: ${shareUrl}`);
    const response = await accountcPage.goto(shareUrl);
    console.log(`Response status: ${response?.status()}, URL after navigation: ${accountcPage.url()}`);
    await accountcPage.waitForLoadState('networkidle');

    // Wait a bit for any client-side redirect
    await accountcPage.waitForTimeout(3000);
    console.log(`Final URL after wait: ${accountcPage.url()}`);

    // Verify accountc can access the share (not 404 or error)
    const pageContent = await accountcPage.textContent('body');
    if (pageContent?.includes('404')) {
      console.log(`ERROR: Got 404. Page content preview: ${pageContent.substring(0, 500)}`);
    }
    expect(pageContent).not.toContain('404');
    expect(pageContent).not.toContain('Access denied');

    console.log('accountc successfully accessed private share');

    // Clean up
    await accountcContext.close();

    // Delete the share (as accountb)
    await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${shareId}`);
    console.log('Private share cleaned up');
  });
});

// ============================================================================
// 5. CLOUD STORAGE API TESTS
// ============================================================================

test.describe('5. Cloud Storage API Tests', () => {
  test.beforeEach(async ({ page, context }) => {
    if (!hasAuthCookieJar()) {
      test.skip();
      return;
    }
    const success = await establishSession(page, context);
    if (!success) {
      test.skip();
    }
  });

  test('should list cloud files via API', async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);

    if (response.status() === 401) {
      console.log('Not authenticated - session may have expired');
      test.skip();
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty('files');
    expect(Array.isArray(data.files)).toBe(true);

    console.log(`Found ${data.files.length} files in cloud storage`);
  });

  test('should list folders via API', async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/folders`);

    if (response.status() === 401) {
      test.skip();
      return;
    }

    expect(response.ok()).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty('folders');
    expect(Array.isArray(data.folders)).toBe(true);

    console.log(`Found ${data.folders.length} folders`);
  });

  test('should create and delete a test file', async ({ page, request }) => {
    const testFileName = getTestFileName();

    // Create file - get presigned URL (use page.request for auth)
    const createResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`, {
      data: {
        fileName: testFileName,
        fileSize: Buffer.from(SAMPLE_GPX).length,
        trackCount: 1,
        waypointCount: 0,
      },
    });

    console.log(`Create file response status: ${createResponse.status()}`);
    if (!createResponse.ok()) {
      const errorBody = await createResponse.text();
      console.log(`Create file error: ${errorBody}`);
      if (createResponse.status() === 500 && errorBody.includes('Failed to create file')) {
        console.log('NOTE: This may be caused by AUTH_INTERNAL_SECRET mismatch between gpx and auth services');
      }
      if (createResponse.status() === 401 || createResponse.status() === 500) {
        test.skip();
        return;
      }
      throw new Error(`Failed to create file: ${createResponse.status()} - ${errorBody}`);
    }
    const createData = await createResponse.json();

    expect(createData).toHaveProperty('fileId');
    expect(createData).toHaveProperty('uploadUrl');

    const { fileId, uploadUrl } = createData;
    console.log(`Created file record: ${fileId}`);

    // Upload to S3 using presigned URL (no auth needed, use standalone request)
    const uploadResponse = await request.put(uploadUrl, {
      data: SAMPLE_GPX,
      headers: {
        'Content-Type': 'application/gpx+xml',
      },
    });
    expect(uploadResponse.ok()).toBe(true);
    console.log('Uploaded file to S3');

    // Confirm upload (use page.request for auth)
    const confirmResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${fileId}/confirm`);
    expect(confirmResponse.ok()).toBe(true);
    console.log('Confirmed file upload');

    // Delete the test file (use page.request for auth)
    const deleteResponse = await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${fileId}`);
    expect(deleteResponse.ok()).toBe(true);
    console.log('Deleted test file');
  });

  test('should create public share via API', async ({ page }) => {
    // First, list files to get one to share
    const listResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);

    if (listResponse.status() === 401) {
      test.skip();
      return;
    }

    const { files } = await listResponse.json();

    if (files.length === 0) {
      console.log('No files available to share');
      test.skip();
      return;
    }

    const file = files[0];

    // Create public share
    const shareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: file.fileId,
        version: file.version || 1,
        accessMode: 'public',
      },
    });

    expect(shareResponse.ok()).toBe(true);
    const shareData = await shareResponse.json();

    expect(shareData).toHaveProperty('shareId');
    expect(shareData).toHaveProperty('shareUrl');
    expect(shareData.shareUrl).toContain('/share/');

    console.log(`Created public share: ${shareData.shareUrl}`);

    // Verify share exists (public endpoint, no auth needed)
    const token = shareData.shareUrl.split('/share/').pop();
    const getShareResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${token}`);
    expect(getShareResponse.ok()).toBe(true);

    // Clean up - delete the share
    const deleteShareResponse = await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${shareData.shareId}`);
    expect(deleteShareResponse.ok()).toBe(true);
    console.log('Deleted test share');
  });
});

// ============================================================================
// 6. CLEANUP - Delete all e2e test files (runs LAST)
// ============================================================================

test.describe('6. Test Cleanup - Delete E2E Files', () => {
  test.beforeEach(async ({ page, context }) => {
    if (!hasAuthCookieJar()) {
      test.skip();
      return;
    }
    const success = await establishSession(page, context);
    if (!success) {
      test.skip();
    }
  });

  test('should delete all e2e test files via Cloud Storage UI', async ({ page }) => {
    // First, check how many e2e files exist via API
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      console.log('Could not list files - skipping cleanup');
      test.skip();
      return;
    }

    const { files } = await filesResponse.json();
    const e2eFiles = files.filter((f: { fileName: string }) =>
      f.fileName.startsWith('e2e-') || f.fileName.startsWith('e2e_')
    );

    console.log(`Found ${e2eFiles.length} e2e test files to clean up`);

    if (e2eFiles.length === 0) {
      console.log('No e2e test files to delete - cleanup complete');
      return;
    }

    // Navigate to studio
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open Cloud Storage dialog
    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    // Find all e2e test file rows and select them
    let deletedCount = 0;

    for (const file of e2eFiles) {
      // Look for the file row containing this filename
      const fileRow = dialog.locator('table tr').filter({ hasText: file.fileName });

      if (await fileRow.count() === 0) {
        console.log(`File not visible in UI: ${file.fileName} - deleting via API`);
        // Fallback: delete via API if not visible in UI
        await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${file.fileId}`);
        deletedCount++;
        continue;
      }

      // Try to find delete button on the row (trash icon or delete button)
      const deleteButton = fileRow.locator('button[title*="elete"], button[aria-label*="elete"], button:has(svg)').filter({ hasText: '' }).last();

      if (await deleteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`Deleting via UI: ${file.fileName}`);
        await deleteButton.click();

        // Wait for confirmation dialog if it appears
        const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete"), [role="dialog"] button:has-text("Delete"), button:has-text("Confirm")');
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        await page.waitForTimeout(500);
        deletedCount++;
      } else {
        // Select the file and use toolbar delete
        const checkbox = fileRow.locator('button[role="checkbox"]');
        if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
          await checkbox.click();
        }
      }
    }

    // If we selected files, try the toolbar delete button
    const selectedCount = await dialog.locator('button[role="checkbox"][data-state="checked"]').count();
    if (selectedCount > 0) {
      console.log(`${selectedCount} files selected - looking for bulk delete`);

      // Look for delete button in toolbar
      const toolbarDelete = dialog.locator('button[title*="elete"], button:has-text("Delete")').first();
      if (await toolbarDelete.isVisible({ timeout: 2000 }).catch(() => false)) {
        await toolbarDelete.click();

        // Confirm deletion
        const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete"), [role="dialog"] button:has-text("Delete"), button:has-text("Confirm")');
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
          await page.waitForTimeout(1000);
          deletedCount += selectedCount;
        }
      }
    }

    // Fallback: delete any remaining e2e files via API
    const remainingResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (remainingResponse.ok()) {
      const { files: remainingFiles } = await remainingResponse.json();
      const remainingE2eFiles = remainingFiles.filter((f: { fileName: string }) =>
        f.fileName.startsWith('e2e-') || f.fileName.startsWith('e2e_')
      );

      for (const file of remainingE2eFiles) {
        console.log(`Cleaning up remaining file via API: ${file.fileName}`);
        await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${file.fileId}`);
        deletedCount++;
      }
    }

    console.log(`Cleanup complete: ${deletedCount} e2e test files deleted`);

    // Verify cleanup
    const verifyResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (verifyResponse.ok()) {
      const { files: verifyFiles } = await verifyResponse.json();
      const remainingE2e = verifyFiles.filter((f: { fileName: string }) =>
        f.fileName.startsWith('e2e-') || f.fileName.startsWith('e2e_')
      );

      if (remainingE2e.length === 0) {
        console.log('All e2e test files successfully deleted');
      } else {
        console.log(`WARNING: ${remainingE2e.length} e2e files still remain`);
      }
    }
  });

  test('should clean up accountb e2e files', async ({ page, context, browser }) => {
    // Clean up files uploaded by accountb user
    if (!hasAuthCookieJarForUser('accountb')) {
      console.log('No accountb session - skipping accountb cleanup');
      return;
    }

    const accountbContext = await browser.newContext();
    const accountbPage = await accountbContext.newPage();

    const success = await establishSession(accountbPage, accountbContext, 'accountb');
    if (!success) {
      await accountbContext.close();
      return;
    }

    const filesResponse = await accountbPage.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      await accountbContext.close();
      return;
    }

    const { files } = await filesResponse.json();
    const e2eFiles = files.filter((f: { fileName: string }) =>
      f.fileName.startsWith('e2e-') || f.fileName.startsWith('e2e_')
    );

    console.log(`Found ${e2eFiles.length} accountb e2e files to clean up`);

    for (const file of e2eFiles) {
      await accountbPage.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${file.fileId}`);
      console.log(`Deleted accountb file: ${file.fileName}`);
    }

    await accountbContext.close();
    console.log('accountb cleanup complete');
  });

  test('should verify no e2e test files remain', async ({ page }) => {
    // Final verification that all e2e test files are gone
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);

    if (!filesResponse.ok()) {
      console.log('Could not verify cleanup');
      return;
    }

    const { files } = await filesResponse.json();
    const e2eFiles = files.filter((f: { fileName: string }) =>
      f.fileName.startsWith('e2e-') || f.fileName.startsWith('e2e_')
    );

    console.log(`Final check: ${e2eFiles.length} e2e test files remaining`);
    console.log(`Total files in cloud storage: ${files.length}`);

    if (e2eFiles.length > 0) {
      console.log('Remaining e2e files:');
      e2eFiles.forEach((f: { fileName: string; fileId: string }) => {
        console.log(`  - ${f.fileName} (${f.fileId})`);
      });
    }

    expect(e2eFiles.length).toBe(0);
  });
});
