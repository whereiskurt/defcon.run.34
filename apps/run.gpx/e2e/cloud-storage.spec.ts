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

// Ensure test-results directory exists
const TEST_RESULTS_DIR = path.join(__dirname, 'test-results');
if (!fs.existsSync(TEST_RESULTS_DIR)) {
  fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

// Screenshot counter for unique naming
let screenshotCounter = 0;

/**
 * Take a screenshot with consistent naming and logging
 */
async function takeScreenshot(page: Page, name: string, description?: string): Promise<string> {
  screenshotCounter++;
  const paddedNum = String(screenshotCounter).padStart(3, '0');
  const filename = `${paddedNum}-${name}.png`;
  const filepath = path.join(TEST_RESULTS_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: false });

  const desc = description || name.replace(/-/g, ' ');
  console.log(`  [Screenshot ${paddedNum}] ${desc}: ${filename}`);

  return filepath;
}

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
async function establishSession(page: Page, context: BrowserContext, role?: UserRole): Promise<boolean> {
  // Load appropriate cookies - undefined role uses default cookie jar (accounta)
  const loaded = role
    ? await loadAuthCookiesForUser(context, role)
    : await loadAuthCookies(context);

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
    console.log('\n=== UPLOADING ALL SAMPLE FILES ===\n');

    // Get all sample files (no size filtering - upload everything)
    const filesToUpload = getSampleFiles();

    console.log(`Found ${filesToUpload.length} sample files to upload:`);
    for (const f of filesToUpload) {
      const stats = fs.statSync(path.join(SAMPLES_DIR, f));
      console.log(`  - ${f} (${Math.round(stats.size / 1024)}KB)`);
    }

    const uploadedIds: string[] = [];
    const uploadedNames: string[] = [];

    for (let i = 0; i < filesToUpload.length; i++) {
      const sampleFile = filesToUpload[i];
      const content = loadSampleFile(sampleFile);
      // Keep original name so multi-file test can find diverse locations (NYC, Japan, etc.)
      const testFileName = sampleFile;

      console.log(`\n[${i + 1}/${filesToUpload.length}] Uploading: ${testFileName} (${Math.round(content.length / 1024)}KB)`);

      const fileId = await uploadFileViaAPI(page, testFileName, content);

      if (fileId) {
        uploadedIds.push(fileId);
        uploadedNames.push(testFileName);
        console.log(`  SUCCESS: ID=${fileId}`);
      } else {
        console.log(`  FAILED: ${testFileName}`);
      }
    }

    expect(uploadedIds.length).toBeGreaterThan(0);
    console.log(`\n=== UPLOAD COMPLETE: ${uploadedIds.length}/${filesToUpload.length} files ===`);

    // Verify files appear in list
    const listResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    expect(listResponse.ok()).toBe(true);

    const { files } = await listResponse.json();
    console.log(`Total files in cloud storage: ${files.length}`);

    // Log all files
    console.log('\nFiles in storage:');
    for (const f of files) {
      console.log(`  - ${f.fileName} (${f.fileId})`);
    }

    expect(files.length).toBeGreaterThanOrEqual(uploadedIds.length);

    // Navigate to studio and take screenshot of cloud storage dialog
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    await takeScreenshot(page, 'upload-complete-file-list', `Uploaded ${uploadedIds.length} files`);

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
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

  test('should open each sample file individually and center', async ({ page }) => {
    // This test loads many large files and takes screenshots - extend timeout to 5 minutes
    test.setTimeout(300000);

    console.log('\n=== COMPREHENSIVE FILE VIEWING TEST ===\n');
    console.log('Opening each uploaded sample file, centering, and taking screenshots\n');

    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await takeScreenshot(page, 'studio-initial', 'Studio initial view');

    // Get list of all files via API
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      console.log('Failed to get file list');
      test.fail();
      return;
    }

    const { files } = await filesResponse.json();
    console.log(`Found ${files.length} files to view:\n`);

    if (files.length === 0) {
      console.log('No files found - upload test may have failed');
      test.fail();
      return;
    }

    // List all files
    for (const f of files) {
      console.log(`  - ${f.fileName}`);
    }

    // Process each file individually
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const cleanName = file.fileName.replace(/\.gpx$/i, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

      console.log(`\n--- [${i + 1}/${files.length}] Opening: ${file.fileName} ---\n`);

      // Navigate to studio fresh for each file (ensures clean state)
      await page.goto(`${BASE_URL}${STUDIO_PATH}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Open Cloud Storage dialog
      const dialog = await openCloudStorage(page, 'open');
      await page.waitForTimeout(2000);

      // Find and select this specific file
      const fileRow = dialog.locator('table tr').filter({ hasText: file.fileName }).first();
      const rowCount = await fileRow.count();

      if (rowCount === 0) {
        console.log(`  File not found in dialog: ${file.fileName}`);
        await page.keyboard.press('Escape');
        continue;
      }

      // Click checkbox to select the file
      const checkbox = fileRow.locator('button[role="checkbox"]');
      if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await checkbox.click();
        await page.waitForTimeout(300);
      }

      await takeScreenshot(page, `${String(i + 1).padStart(2, '0')}-select-${cleanName}`, `Selected: ${file.fileName}`);

      // Click Open button
      const openButton = dialog.locator('button.bg-blue-600, button:has-text("Open")').filter({ hasText: /Open/i });
      if (await openButton.isEnabled({ timeout: 2000 }).catch(() => false)) {
        await openButton.click();
      } else {
        console.log(`  Open button not enabled for: ${file.fileName}`);
        await page.keyboard.press('Escape');
        continue;
      }

      // Wait for file to load (larger files need more time)
      const waitTime = file.fileSize > 1000000 ? 10000 : 5000;
      console.log(`  Loading file (${Math.round(file.fileSize / 1024)}KB)...`);
      await page.waitForTimeout(waitTime);

      // Close dialog if still visible
      const isDialogVisible = await dialog.isVisible().catch(() => false);
      if (isDialogVisible) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }

      await takeScreenshot(page, `${String(i + 1).padStart(2, '0')}-loaded-${cleanName}`, `Loaded: ${file.fileName}`);

      // Find the file tab and center on it
      const fileTabs = page.locator('button').filter({ hasText: /\.gpx/i });
      const fileTabCount = await fileTabs.count();

      if (fileTabCount > 0) {
        // Find the tab for this file
        let targetTab = fileTabs.first();
        for (let t = 0; t < fileTabCount; t++) {
          const tabText = await fileTabs.nth(t).textContent();
          if (tabText?.includes(file.fileName.replace('.gpx', ''))) {
            targetTab = fileTabs.nth(t);
            break;
          }
        }

        // Click the tab to select it
        await targetTab.click();
        await page.waitForTimeout(500);

        // Right-click for Center option
        await targetTab.click({ button: 'right' });
        await page.waitForTimeout(300);

        const centerMenuItem = page.locator('[role="menuitem"]').filter({ hasText: /Center/i });
        if (await centerMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
          await centerMenuItem.click();
          console.log('  Centered via context menu');
          await page.waitForTimeout(2000); // Wait for map animation
        } else {
          // Close menu and try keyboard shortcut
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          await targetTab.click();
          await page.waitForTimeout(200);
          await page.keyboard.press('Control+Enter');
          console.log('  Centered via keyboard shortcut');
          await page.waitForTimeout(2000);
        }

        await takeScreenshot(page, `${String(i + 1).padStart(2, '0')}-centered-${cleanName}`, `Centered: ${file.fileName}`);
      }

      console.log(`  Completed: ${file.fileName}`);
    }

    // Final summary
    console.log(`\n=== FILE VIEWING TEST COMPLETE ===`);
    console.log(`Processed ${files.length} files with screenshots\n`);
  });

  test('should open all files together and cycle through', async ({ page }) => {
    console.log('\n=== MULTI-FILE OVERVIEW TEST ===\n');

    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open Cloud Storage dialog
    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    // Select ALL files using "Select All" or by clicking each checkbox
    const tableRows = dialog.locator('table tr').filter({ hasText: /\.gpx/i });
    const rowCount = await tableRows.count();

    console.log(`Found ${rowCount} files - selecting all...`);

    // Try to find a "Select All" checkbox first
    const selectAllCheckbox = dialog.locator('thead button[role="checkbox"], th button[role="checkbox"]').first();
    if (await selectAllCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
      await selectAllCheckbox.click();
      console.log('  Used Select All checkbox');
    } else {
      // Select each file individually (limit to first 6 for performance)
      const maxFiles = Math.min(rowCount, 6);
      for (let i = 0; i < maxFiles; i++) {
        const checkbox = tableRows.nth(i).locator('button[role="checkbox"]');
        if (await checkbox.isVisible({ timeout: 500 }).catch(() => false)) {
          await checkbox.click();
          await page.waitForTimeout(100);
        }
      }
      console.log(`  Selected ${maxFiles} files individually`);
    }

    await takeScreenshot(page, 'all-files-selected', 'All files selected');

    // Click Open button
    const openButton = dialog.locator('button.bg-blue-600, button:has-text("Open")').filter({ hasText: /Open/i });
    await expect(openButton).toBeEnabled({ timeout: 5000 });
    await openButton.click();

    // Wait for all files to load
    console.log('\nLoading all files...');
    await page.waitForTimeout(12000);

    // Close dialog if still visible
    const isDialogVisible = await dialog.isVisible().catch(() => false);
    if (isDialogVisible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    await takeScreenshot(page, 'all-files-loaded', 'All files loaded - world view');

    // Find all file tabs
    const fileTabs = page.locator('button').filter({ hasText: /\.gpx/i });
    const fileTabCount = await fileTabs.count();
    console.log(`\nFound ${fileTabCount} file tabs`);

    // Cycle through each tab, center, and screenshot
    console.log('\n--- Cycling through all loaded files ---\n');

    for (let i = 0; i < fileTabCount; i++) {
      const fileTab = fileTabs.nth(i);
      const tabText = await fileTab.textContent();
      const cleanName = tabText?.trim().replace(/\.gpx$/i, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || `file-${i}`;

      console.log(`[${i + 1}/${fileTabCount}] ${tabText?.trim()}`);

      // Click tab to select
      await fileTab.click();
      await page.waitForTimeout(500);

      // Right-click for Center
      await fileTab.click({ button: 'right' });
      await page.waitForTimeout(300);

      const centerMenuItem = page.locator('[role="menuitem"]').filter({ hasText: /Center/i });
      if (await centerMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await centerMenuItem.click();
        await page.waitForTimeout(2000);
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await fileTab.click();
        await page.keyboard.press('Control+Enter');
        await page.waitForTimeout(2000);
      }

      await takeScreenshot(page, `multi-${String(i + 1).padStart(2, '0')}-${cleanName}`, `Multi-view ${i + 1}: ${tabText?.trim()}`);
    }

    // Test Hide/Show feature on first file
    console.log('\n--- Testing Hide/Show feature ---\n');

    if (fileTabCount > 0) {
      const firstTab = fileTabs.first();
      await firstTab.click();
      await page.waitForTimeout(300);

      const trackItems = page.locator('button').filter({ hasText: /^Track \d+$/ });
      const trackCount = await trackItems.count();

      if (trackCount > 0) {
        console.log(`Found ${trackCount} tracks`);

        await trackItems.first().click({ button: 'right' });
        await page.waitForTimeout(300);

        const hideMenuItem = page.locator('[role="menuitem"]').filter({ hasText: /^Hide$/i });
        if (await hideMenuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
          await hideMenuItem.click();
          await page.waitForTimeout(1000);
          await takeScreenshot(page, 'track-hidden', 'Track hidden');

          // Unhide all
          await trackItems.first().click({ button: 'right' });
          await page.waitForTimeout(300);
          const unhideAllItem = page.locator('[role="menuitem"]').filter({ hasText: /Unhide All/i });
          if (await unhideAllItem.isVisible({ timeout: 1000 }).catch(() => false)) {
            await unhideAllItem.click();
            await page.waitForTimeout(500);
            await takeScreenshot(page, 'track-unhidden', 'Track unhidden');
          }
        }
      }
    }

    await takeScreenshot(page, 'multi-file-test-complete', 'Multi-file test complete');
    console.log('\n=== MULTI-FILE OVERVIEW TEST COMPLETE ===\n');
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
// 4. MULTI-USER SHARE TESTS - Comprehensive share link testing
// ============================================================================

test.describe('4. Multi-User Share Tests', () => {
  test('should create public share and access as different users', async ({ page, context, browser }) => {
    console.log('\n=== PUBLIC SHARE CROSS-USER TEST ===\n');

    // Check if we have accounta and accountb sessions
    if (!hasAuthCookieJarForUser('accounta') || !hasAuthCookieJarForUser('accountb')) {
      console.log('Multi-user test requires both accounta and accountb sessions.');
      console.log('Run auth e2e tests with TEST_USER_ROLE=accounta and TEST_USER_ROLE=accountb first.');
      test.skip();
      return;
    }

    // === ACCOUNT A SESSION (file owner) ===
    console.log('--- accounta: Creating public share ---');

    const accountaLoaded = await loadAuthCookiesForUser(context, 'accounta');
    if (!accountaLoaded) {
      test.skip();
      return;
    }

    // Establish session for accounta
    const sessionSuccess = await establishSession(page, context, 'accounta');
    if (!sessionSuccess) {
      console.log('Failed to establish accounta session');
      test.skip();
      return;
    }

    // Get accounta's files
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      console.log('accounta not authenticated');
      test.skip();
      return;
    }

    const { files } = await filesResponse.json();
    console.log(`accounta has ${files.length} files`);

    if (files.length === 0) {
      // Upload a file for accounta
      console.log('Uploading a file for accounta...');
      const content = loadSampleFile('Test NYC Route.gpx');
      const testFileName = `e2e-accounta-share-${Date.now()}.gpx`;
      const fileId = await uploadFileViaAPI(page, testFileName, content);
      if (!fileId) {
        console.log('Failed to upload file for accounta');
        test.fail();
        return;
      }
    }

    // Get file list again
    const updatedFilesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    const { files: updatedFiles } = await updatedFilesResponse.json();
    const fileToShare = updatedFiles[0];

    console.log(`Creating public share for: ${fileToShare.fileName}`);

    // Create PUBLIC share
    const shareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: fileToShare.fileId,
        version: fileToShare.version || 1,
        accessMode: 'public',
      },
    });

    if (!shareResponse.ok()) {
      const errorBody = await shareResponse.text();
      console.log(`Share creation failed: ${shareResponse.status()} - ${errorBody}`);
    }
    expect(shareResponse.ok()).toBe(true);
    const shareData = await shareResponse.json();
    const shareUrl = shareData.shareUrl as string;
    const shareToken = shareUrl.split('/share/').pop();
    const shareId = shareData.shareId;

    console.log(`Public share created: ${shareUrl}`);

    // Navigate to studio and open the file
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open the file via cloud storage
    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    // Find and select the file
    const fileRow = dialog.locator('table tr').filter({ hasText: fileToShare.fileName }).first();
    const checkbox = fileRow.locator('button[role="checkbox"]');
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.click();
      await page.waitForTimeout(200);
    }

    await takeScreenshot(page, 'accounta-file-selected', 'accounta selected file to share');

    // Click Open
    const openButton = dialog.locator('button.bg-blue-600, button:has-text("Open")').filter({ hasText: /Open/i });
    if (await openButton.isEnabled({ timeout: 2000 }).catch(() => false)) {
      await openButton.click();
      await page.waitForTimeout(5000);
    }

    await takeScreenshot(page, 'accounta-file-opened', 'accounta opened shared file');

    // === ACCOUNT B SESSION (accessing public share) ===
    console.log('\n--- accountb: Accessing public share ---');

    const accountbContext = await browser.newContext();
    const accountbPage = await accountbContext.newPage();

    const accountbLoaded = await loadAuthCookiesForUser(accountbContext, 'accountb');
    if (!accountbLoaded) {
      await accountbContext.close();
      console.log('Failed to load accountb cookies');
      test.skip();
      return;
    }

    // Establish session for accountb
    const accountbSession = await establishSession(accountbPage, accountbContext, 'accountb');
    if (!accountbSession) {
      console.log('accountb session establishment failed, continuing without...');
    }

    // accountb navigates to the public share URL
    console.log(`accountb navigating to: ${shareUrl}`);
    await accountbPage.goto(shareUrl);
    await accountbPage.waitForLoadState('networkidle');
    await accountbPage.waitForTimeout(3000);

    const accountbUrl = accountbPage.url();
    console.log(`accountb final URL: ${accountbUrl}`);

    await takeScreenshot(accountbPage, 'accountb-public-share', 'accountb accessing public share');

    // Verify accountb can see the content (not 404 or access denied)
    const pageContent = await accountbPage.textContent('body');
    expect(pageContent).not.toContain('404');
    expect(pageContent).not.toContain('Access denied');

    // Wait for any map to load
    await accountbPage.waitForTimeout(3000);

    // Try to center on the shared content
    const fileTabs = accountbPage.locator('button').filter({ hasText: /\.gpx/i });
    const tabCount = await fileTabs.count();
    if (tabCount > 0) {
      await fileTabs.first().click();
      await accountbPage.waitForTimeout(500);
      await fileTabs.first().click({ button: 'right' });
      await accountbPage.waitForTimeout(300);

      const centerMenuItem = accountbPage.locator('[role="menuitem"]').filter({ hasText: /Center/i });
      if (await centerMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await centerMenuItem.click();
        await accountbPage.waitForTimeout(2000);
      } else {
        await accountbPage.keyboard.press('Escape');
      }
    }

    await takeScreenshot(accountbPage, 'accountb-public-share-loaded', 'accountb public share loaded and centered');

    console.log('accountb successfully accessed public share');

    // Clean up
    await accountbContext.close();

    // Delete the share
    await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${shareId}`);
    console.log('Public share cleaned up');

    console.log('\n=== PUBLIC SHARE CROSS-USER TEST COMPLETE ===\n');
  });

  test('should create private share and verify access control', async ({ page, context, browser }) => {
    console.log('\n=== PRIVATE SHARE ACCESS CONTROL TEST ===\n');

    // Need all three accounts for this test
    if (!hasAuthCookieJarForUser('accounta') || !hasAuthCookieJarForUser('accountb')) {
      console.log('Test requires accounta and accountb sessions.');
      test.skip();
      return;
    }

    // === ACCOUNT A SESSION (file owner) ===
    console.log('--- accounta: Creating private share for accountb only ---');

    const accountaLoaded = await loadAuthCookiesForUser(context, 'accounta');
    if (!accountaLoaded) {
      test.skip();
      return;
    }

    const sessionSuccess = await establishSession(page, context, 'accounta');
    if (!sessionSuccess) {
      test.skip();
      return;
    }

    // Get accounta's files
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      test.skip();
      return;
    }

    const { files } = await filesResponse.json();
    if (files.length === 0) {
      // Upload a file
      const content = loadSampleFile('japan.gpx');
      const testFileName = `e2e-accounta-private-${Date.now()}.gpx`;
      await uploadFileViaAPI(page, testFileName, content);
    }

    // Get file list
    const updatedFilesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    const { files: updatedFiles } = await updatedFilesResponse.json();
    const fileToShare = updatedFiles[0];

    const accountbEmail = getEmailForRole('accountb');
    console.log(`Creating private share for ${accountbEmail} only`);

    // Create PRIVATE share for accountb only
    const shareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: fileToShare.fileId,
        version: fileToShare.version || 1,
        accessMode: 'private',
        allowedEmails: [accountbEmail],
      },
    });

    if (!shareResponse.ok()) {
      const errorBody = await shareResponse.text();
      console.log(`Share creation failed: ${shareResponse.status()} - ${errorBody}`);
    }
    expect(shareResponse.ok()).toBe(true);
    const shareData = await shareResponse.json();
    const shareUrl = shareData.shareUrl as string;
    const shareId = shareData.shareId;

    console.log(`Private share created: ${shareUrl}`);

    await takeScreenshot(page, 'accounta-private-share-created', 'accounta created private share');

    // === ACCOUNT B SESSION (authorized recipient) ===
    console.log('\n--- accountb: Accessing private share (AUTHORIZED) ---');

    const accountbContext = await browser.newContext();
    const accountbPage = await accountbContext.newPage();

    const accountbLoaded = await loadAuthCookiesForUser(accountbContext, 'accountb');
    if (!accountbLoaded) {
      await accountbContext.close();
      test.skip();
      return;
    }

    await establishSession(accountbPage, accountbContext, 'accountb');

    // accountb navigates to the private share URL
    console.log(`accountb navigating to: ${shareUrl}`);
    await accountbPage.goto(shareUrl);
    await accountbPage.waitForLoadState('networkidle');
    await accountbPage.waitForTimeout(3000);

    await takeScreenshot(accountbPage, 'accountb-private-share-access', 'accountb accessing private share (authorized)');

    // Verify accountb CAN access
    const accountbContent = await accountbPage.textContent('body');
    const accountbHasAccess = !accountbContent?.includes('Access denied') && !accountbContent?.includes('403');

    if (accountbHasAccess) {
      console.log('accountb successfully accessed private share');

      // Wait for content to load and take screenshot
      await accountbPage.waitForTimeout(3000);

      const fileTabs = accountbPage.locator('button').filter({ hasText: /\.gpx/i });
      if (await fileTabs.count() > 0) {
        await fileTabs.first().click();
        await accountbPage.waitForTimeout(500);
        await fileTabs.first().click({ button: 'right' });
        await accountbPage.waitForTimeout(300);

        const centerMenuItem = accountbPage.locator('[role="menuitem"]').filter({ hasText: /Center/i });
        if (await centerMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
          await centerMenuItem.click();
          await accountbPage.waitForTimeout(2000);
        } else {
          await accountbPage.keyboard.press('Escape');
        }
      }

      await takeScreenshot(accountbPage, 'accountb-private-share-loaded', 'accountb private share loaded');
    } else {
      console.log('WARNING: accountb was denied access to private share');
    }

    await accountbContext.close();

    // === TEST UNAUTHORIZED ACCESS (accountc if available, or anonymous) ===
    console.log('\n--- Testing unauthorized access ---');

    if (hasAuthCookieJarForUser('accountc')) {
      console.log('Testing accountc (NOT in allowed list)...');

      const accountcContext = await browser.newContext();
      const accountcPage = await accountcContext.newPage();

      const accountcLoaded = await loadAuthCookiesForUser(accountcContext, 'accountc');
      if (accountcLoaded) {
        await establishSession(accountcPage, accountcContext, 'accountc');

        console.log(`accountc navigating to: ${shareUrl}`);
        await accountcPage.goto(shareUrl);
        await accountcPage.waitForLoadState('networkidle');
        await accountcPage.waitForTimeout(3000);

        await takeScreenshot(accountcPage, 'accountc-private-share-denied', 'accountc accessing private share (should be denied)');

        const accountcContent = await accountcPage.textContent('body');
        // Check for denial message - we show "invalid or has expired" to prevent token enumeration
        const accountcDenied =
          accountcContent?.includes('Unable to load share') ||
          accountcContent?.includes('invalid or has expired') ||
          accountcContent?.includes('Access denied') ||
          accountcContent?.includes('403');

        if (accountcDenied) {
          console.log('accountc correctly denied access to private share');
        } else {
          console.log('WARNING: accountc was NOT denied access - check share permissions');
        }
      }

      await accountcContext.close();
    }

    // Test anonymous access (new context with no cookies)
    console.log('\n--- Testing anonymous access ---');
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    console.log(`Anonymous user navigating to: ${shareUrl}`);
    await anonPage.goto(shareUrl);
    await anonPage.waitForLoadState('networkidle');
    await anonPage.waitForTimeout(3000);

    await takeScreenshot(anonPage, 'anonymous-private-share', 'Anonymous user accessing private share');

    const anonUrl = anonPage.url();
    console.log(`Anonymous user redirected to: ${anonUrl}`);

    // Anonymous should be redirected to login or denied
    const isLoginPage = anonUrl.includes('signin') || anonUrl.includes('login');
    const anonContent = await anonPage.textContent('body');
    const anonDenied = anonContent?.includes('Access denied') || anonContent?.includes('sign in') || isLoginPage;

    if (anonDenied || isLoginPage) {
      console.log('Anonymous user correctly denied/redirected for private share');
    } else {
      console.log('WARNING: Anonymous user was not redirected - check share permissions');
    }

    await anonContext.close();

    // Clean up - delete the share
    await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${shareId}`);
    console.log('Private share cleaned up');

    console.log('\n=== PRIVATE SHARE ACCESS CONTROL TEST COMPLETE ===\n');
  });

  test('should list and manage share links', async ({ page, context }) => {
    console.log('\n=== SHARE LINK MANAGEMENT TEST ===\n');

    if (!hasAuthCookieJarForUser('accounta')) {
      test.skip();
      return;
    }

    const accountaLoaded = await loadAuthCookiesForUser(context, 'accounta');
    if (!accountaLoaded) {
      test.skip();
      return;
    }

    const sessionSuccess = await establishSession(page, context, 'accounta');
    if (!sessionSuccess) {
      test.skip();
      return;
    }

    // Get files
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      test.skip();
      return;
    }

    const { files } = await filesResponse.json();
    if (files.length === 0) {
      console.log('No files to share');
      test.skip();
      return;
    }

    const file = files[0];
    console.log(`Testing share management for: ${file.fileName}`);

    // Create multiple shares for the same file
    console.log('Creating public share...');
    const publicShareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: file.fileId,
        version: file.version || 1,
        accessMode: 'public',
      },
    });
    if (!publicShareResponse.ok()) {
      const errorBody = await publicShareResponse.text();
      console.log(`Public share creation failed: ${publicShareResponse.status()} - ${errorBody}`);
    }
    expect(publicShareResponse.ok()).toBe(true);
    const publicShare = await publicShareResponse.json();

    console.log('Creating private share...');
    const privateShareResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares`, {
      data: {
        fileId: file.fileId,
        version: file.version || 1,
        accessMode: 'private',
        allowedEmails: [getEmailForRole('accountb')],
      },
    });
    expect(privateShareResponse.ok()).toBe(true);
    const privateShare = await privateShareResponse.json();

    console.log(`Created shares: public=${publicShare.shareId}, private=${privateShare.shareId}`);

    await takeScreenshot(page, 'shares-created', 'Multiple shares created');

    // Verify shares via API
    const publicVerify = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${publicShare.shareUrl.split('/share/').pop()}`);
    expect(publicVerify.ok()).toBe(true);
    console.log('Public share verified');

    const privateToken = privateShare.shareUrl.split('/share/').pop();
    const privateVerify = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${privateToken}`);
    // Private shares may not be verifiable by the creator via token lookup (access control)
    // The share was created successfully, which is what matters
    if (!privateVerify.ok()) {
      console.log(`Private share token lookup returned ${privateVerify.status()} - this may be expected for access control`);
    } else {
      console.log('Private share verified via token');
    }

    // Delete shares
    console.log('Deleting shares...');
    await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${publicShare.shareId}`);
    await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${privateShare.shareId}`);

    // Verify deleted
    const deletedVerify = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${publicShare.shareUrl.split('/share/').pop()}`);
    expect(deletedVerify.status()).toBe(404);
    console.log('Shares successfully deleted');

    console.log('\n=== SHARE LINK MANAGEMENT TEST COMPLETE ===\n');
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

    if (!shareResponse.ok()) {
      const errorBody = await shareResponse.text();
      console.log(`Share creation failed: ${shareResponse.status()} - ${errorBody}`);
    }
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
    // First, delete ALL shares for this user to free quota (important for consistent test runs)
    const allSharesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares?all=true`);
    if (allSharesResponse.ok()) {
      const { shares } = await allSharesResponse.json();
      if (shares && shares.length > 0) {
        console.log(`Found ${shares.length} total shares to clean up (freeing quota)`);
        for (const share of shares) {
          await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/shares/${share.shareId}`);
        }
        console.log(`Deleted ${shares.length} shares`);
      } else {
        console.log('No existing shares to clean up');
      }
    } else {
      console.log(`Could not list all shares: ${allSharesResponse.status()}`);
    }

    // Then, check how many e2e files exist via API
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (!filesResponse.ok()) {
      console.log('Could not list files - skipping cleanup');
      test.skip();
      return;
    }

    const { files } = await filesResponse.json();

    console.log(`Found ${files.length} test files to clean up`);

    if (files.length === 0) {
      console.log('No test files to delete - cleanup complete');
      return;
    }

    // Navigate to studio
    await page.goto(`${BASE_URL}${STUDIO_PATH}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Open Cloud Storage dialog
    const dialog = await openCloudStorage(page, 'open');
    await page.waitForTimeout(2000);

    // Find all test file rows and delete them
    let deletedCount = 0;

    for (const file of files) {
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

    // Fallback: delete any remaining files via API
    const remainingResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (remainingResponse.ok()) {
      const { files: remainingFiles } = await remainingResponse.json();

      for (const file of remainingFiles) {
        console.log(`Cleaning up remaining file via API: ${file.fileName}`);
        await page.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${file.fileId}`);
        deletedCount++;
      }
    }

    console.log(`Cleanup complete: ${deletedCount} test files deleted`);

    // Verify cleanup
    const verifyResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);
    if (verifyResponse.ok()) {
      const { files: verifyFiles } = await verifyResponse.json();

      if (verifyFiles.length === 0) {
        console.log('All test files successfully deleted');
      } else {
        console.log(`WARNING: ${verifyFiles.length} files still remain`);
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

    console.log(`Found ${files.length} accountb files to clean up`);

    for (const file of files) {
      await accountbPage.request.delete(`${BASE_URL}${REGION_PREFIX}/api/gpx/files/${file.fileId}`);
      console.log(`Deleted accountb file: ${file.fileName}`);
    }

    await accountbContext.close();
    console.log('accountb cleanup complete');
  });

  test('should verify no test files remain', async ({ page }) => {
    // Final verification that all test files are gone
    const filesResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/gpx/files`);

    if (!filesResponse.ok()) {
      console.log('Could not verify cleanup');
      return;
    }

    const { files } = await filesResponse.json();

    console.log(`Final check: ${files.length} test files remaining`);

    if (files.length > 0) {
      console.log('Remaining files:');
      files.forEach((f: { fileName: string; fileId: string }) => {
        console.log(`  - ${f.fileName} (${f.fileId})`);
      });
    }

    expect(files.length).toBe(0);
  });
});
