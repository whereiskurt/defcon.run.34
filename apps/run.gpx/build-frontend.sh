#!/bin/bash
# Builds gpx.studio frontend and integrates with Next.js webapp
# Usage: ./build-frontend.sh
#
# This script:
# 1. Applies patches to gpx-studio submodule (creates required files)
# 2. Builds gpx-studio SvelteKit app
# 3. Copies built output to webapp/public/gpx-studio/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GPX_STUDIO_DIR="$SCRIPT_DIR/gpx-studio/website"
WEBAPP_DIR="$SCRIPT_DIR/webapp"
OUTPUT_DIR="$WEBAPP_DIR/public/gpx-studio"

echo "=== Building GPX Studio frontend ==="
echo "Version: $(cat "$SCRIPT_DIR/VERSION")"
echo ""

# Check if gpx-studio submodule is initialized
if [ ! -d "$GPX_STUDIO_DIR" ] || [ ! -f "$GPX_STUDIO_DIR/package.json" ]; then
  echo "Initializing gpx-studio submodule..."
  cd "$SCRIPT_DIR"
  git submodule update --init --recursive gpx-studio
fi

# Navigate to gpx.studio website directory
cd "$GPX_STUDIO_DIR"

echo "1. Creating patched files..."
# Note: The patch files in patches/ are documentation.
# The actual files need to be created here or maintained in a fork.
# For now, we'll create the essential files if they don't exist.

# Create cloud-sync.ts if not exists
if [ ! -f "src/lib/cloud-sync.ts" ]; then
  echo "   Creating cloud-sync.ts..."
  mkdir -p src/lib
  cat > src/lib/cloud-sync.ts << 'CLOUDSYNC_EOF'
/**
 * Cloud Sync Layer for GPX Studio
 * Syncs local IndexedDB storage with our S3-backed API
 */
import { writable } from 'svelte/store';

export const cloudSyncStatus = writable<'idle' | 'syncing' | 'error'>('idle');
export const cloudSyncError = writable<string | null>(null);

const API_BASE = '/api/gpx';

export async function listCloudFiles() {
  const response = await fetch(`${API_BASE}/files`);
  if (!response.ok) throw new Error('Failed to list files');
  return (await response.json()).files;
}

export async function saveToCloud(gpxContent: string, fileName: string) {
  cloudSyncStatus.set('syncing');
  try {
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const presignResponse = await fetch(`${API_BASE}/upload/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, contentType: 'application/gpx+xml' }),
    });
    if (!presignResponse.ok) throw new Error('Failed to get upload URL');
    const { uploadUrl, fileId, key, bucket } = await presignResponse.json();

    await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/gpx+xml' }, body: blob });

    await fetch(`${API_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, fileName, bucket, key, fileSize: blob.size }),
    });

    cloudSyncStatus.set('idle');
    return fileId;
  } catch (error) {
    cloudSyncStatus.set('error');
    throw error;
  }
}

export async function loadFromCloud(fileId: string) {
  const response = await fetch(`${API_BASE}/download/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  if (!response.ok) throw new Error('Failed to get download URL');
  const { downloadUrl, fileName } = await response.json();
  const content = await (await fetch(downloadUrl)).text();
  return { content, fileName };
}

export async function deleteFromCloud(fileId: string) {
  await fetch(`${API_BASE}/files/${fileId}`, { method: 'DELETE' });
}
CLOUDSYNC_EOF
fi

# Create auth store if not exists
if [ ! -f "src/lib/stores/auth.ts" ]; then
  echo "   Creating auth store..."
  mkdir -p src/lib/stores
  cat > src/lib/stores/auth.ts << 'AUTH_EOF'
import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export interface User {
  id: string;
  name?: string;
  email?: string;
  image?: string;
  services?: string[];
  mapboxPublicToken?: string;
}

function createAuthStore() {
  const { subscribe, set, update } = writable({
    user: null as User | null,
    isLoading: true,
    isAuthenticated: false,
    error: null as string | null,
  });

  async function checkSession() {
    if (!browser) return;
    update(s => ({ ...s, isLoading: true }));
    try {
      const response = await fetch('/api/auth/session');
      const session = await response.json();
      if (session?.user?.services?.includes('gpxstudio')) {
        set({ user: session.user, isLoading: false, isAuthenticated: true, error: null });
      } else {
        set({ user: null, isLoading: false, isAuthenticated: false, error: session?.user ? 'Access denied' : null });
      }
    } catch {
      set({ user: null, isLoading: false, isAuthenticated: false, error: 'Session check failed' });
    }
  }

  return { subscribe, checkSession, logout: () => window.location.href = '/api/auth/signout' };
}

export const auth = createAuthStore();
export const currentUser = derived(auth, $a => $a.user);
export const isAuthenticated = derived(auth, $a => $a.isAuthenticated);
export const isAuthLoading = derived(auth, $a => $a.isLoading);
AUTH_EOF
fi

echo "2. Installing dependencies..."
npm install

echo "3. Building gpx.studio..."
# Set BASE_PATH so SvelteKit prefixes all asset URLs with /gpx-studio
BASE_PATH=/gpx-studio npm run build

echo "4. Copying build output to webapp..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
cp -r build/* "$OUTPUT_DIR/"

echo ""
echo "=== Build complete ==="
echo "Output: $OUTPUT_DIR"
