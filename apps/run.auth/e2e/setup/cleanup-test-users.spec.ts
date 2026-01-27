/**
 * Cleanup Test Users
 *
 * Removes test user data from DynamoDB tables before running tests.
 * This ensures a fresh start for each test run.
 *
 * Usage:
 *   # Cleanup all test accounts (dry run)
 *   npx playwright test setup/cleanup-test-users.spec.ts
 *
 *   # Actually delete (set CLEANUP_EXECUTE=true)
 *   CLEANUP_EXECUTE=true npx playwright test setup/cleanup-test-users.spec.ts
 *
 *   # Cleanup specific account
 *   TEST_USER_ROLE=accounta CLEANUP_EXECUTE=true npx playwright test setup/cleanup-test-users.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  DynamoDBClient,
  QueryCommand,
  DeleteItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { getEmailForRole, type UserRole } from '../lib/cookie-jar.js';

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const EXECUTE = process.env.CLEANUP_EXECUTE === 'true';
const SPECIFIC_ROLE = process.env.TEST_USER_ROLE as UserRole | undefined;

// Table names
const AUTH_AUTHJS_TABLE = process.env.AUTH_AUTHJS_TABLE || 'run-auth-authjs';
const AUTH_ELECTRO_TABLE = process.env.AUTH_ELECTRO_TABLE || 'run-auth-electro';
const QUOTA_TABLE = process.env.QUOTA_TABLE || 'run-quota-electro';
const GPX_TABLE = process.env.GPX_TABLE || 'run-gpx-electro';

// Test emails to clean up
const ALL_ROLES: UserRole[] = ['accounta', 'accountb', 'accountc'];
const ROLES_TO_CLEAN = SPECIFIC_ROLE ? [SPECIFIC_ROLE] : ALL_ROLES;
const EMAILS_TO_CLEAN = ROLES_TO_CLEAN.map(role => getEmailForRole(role));

const dynamodb = new DynamoDBClient({ region: AWS_REGION });

interface CleanupStats {
  authjs: number;
  profile: number;
  quota: number;
  gpx: number;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  try {
    const result = await dynamodb.send(new QueryCommand({
      TableName: AUTH_AUTHJS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#email#${email}` },
      },
    }));

    if (result.Items && result.Items.length > 0) {
      const pk = result.Items[0].pk?.S;
      if (pk?.startsWith('USER#')) {
        return pk.substring(5); // Remove "USER#" prefix
      }
    }
  } catch (error) {
    console.log(`  Error querying for ${email}:`, error);
  }
  return null;
}

async function deleteItem(table: string, pk: string, sk?: string): Promise<boolean> {
  const key: Record<string, { S: string }> = { pk: { S: pk } };
  if (sk) {
    key.sk = { S: sk };
  }

  if (!EXECUTE) {
    console.log(`  [DRY RUN] Would delete from ${table}: ${pk} / ${sk || '(no sk)'}`);
    return true;
  }

  try {
    await dynamodb.send(new DeleteItemCommand({
      TableName: table,
      Key: key,
    }));
    console.log(`  Deleted from ${table}: ${pk} / ${sk || '(no sk)'}`);
    return true;
  } catch (error) {
    console.log(`  Failed to delete from ${table}: ${pk}`, error);
    return false;
  }
}

async function cleanupAuthJsRecords(userId: string): Promise<number> {
  let deleted = 0;

  // Query all records for this user
  try {
    const userRecords = await dynamodb.send(new QueryCommand({
      TableName: AUTH_AUTHJS_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
      },
    }));

    for (const item of userRecords.Items || []) {
      if (await deleteItem(AUTH_AUTHJS_TABLE, item.pk?.S || '', item.sk?.S)) {
        deleted++;
      }
    }
  } catch (error) {
    console.log(`  Error querying user records:`, error);
  }

  // Scan for account links and sessions (they reference userId)
  try {
    const linkedRecords = await dynamodb.send(new ScanCommand({
      TableName: AUTH_AUTHJS_TABLE,
      FilterExpression: 'contains(pk, :uid)',
      ExpressionAttributeValues: {
        ':uid': { S: userId },
      },
    }));

    for (const item of linkedRecords.Items || []) {
      if (await deleteItem(AUTH_AUTHJS_TABLE, item.pk?.S || '', item.sk?.S)) {
        deleted++;
      }
    }
  } catch (error) {
    console.log(`  Error scanning for linked records:`, error);
  }

  return deleted;
}

async function cleanupProfileRecords(userId: string): Promise<number> {
  let deleted = 0;

  try {
    const profileRecords = await dynamodb.send(new QueryCommand({
      TableName: AUTH_ELECTRO_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `$authprofile#userId_${userId}` },
      },
    }));

    for (const item of profileRecords.Items || []) {
      if (await deleteItem(AUTH_ELECTRO_TABLE, item.pk?.S || '', item.sk?.S)) {
        deleted++;
      }
    }
  } catch (error) {
    console.log(`  Error querying profile records:`, error);
  }

  return deleted;
}

async function cleanupQuotaRecords(userId: string): Promise<number> {
  let deleted = 0;

  try {
    const quotaRecords = await dynamodb.send(new QueryCommand({
      TableName: QUOTA_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `$userquota#userId_${userId}` },
      },
    }));

    for (const item of quotaRecords.Items || []) {
      if (await deleteItem(QUOTA_TABLE, item.pk?.S || '', item.sk?.S)) {
        deleted++;
      }
    }
  } catch (error) {
    console.log(`  Error querying quota records:`, error);
  }

  return deleted;
}

async function cleanupGpxRecords(userId: string): Promise<number> {
  let deleted = 0;

  // GPX files
  try {
    const fileRecords = await dynamodb.send(new QueryCommand({
      TableName: GPX_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `$gpxfile#userId_${userId}` },
      },
    }));

    for (const item of fileRecords.Items || []) {
      if (await deleteItem(GPX_TABLE, item.pk?.S || '', item.sk?.S)) {
        deleted++;
      }
    }
  } catch (error) {
    console.log(`  Error querying GPX file records:`, error);
  }

  // GPX folders
  try {
    const folderRecords = await dynamodb.send(new QueryCommand({
      TableName: GPX_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `$gpxfolder#userId_${userId}` },
      },
    }));

    for (const item of folderRecords.Items || []) {
      if (await deleteItem(GPX_TABLE, item.pk?.S || '', item.sk?.S)) {
        deleted++;
      }
    }
  } catch (error) {
    console.log(`  Error querying GPX folder records:`, error);
  }

  return deleted;
}

async function cleanupUser(email: string): Promise<CleanupStats> {
  const stats: CleanupStats = { authjs: 0, profile: 0, quota: 0, gpx: 0 };

  console.log(`\nLooking up user: ${email}`);
  const userId = await findUserIdByEmail(email);

  if (!userId) {
    console.log(`  No user found for ${email}`);
    return stats;
  }

  console.log(`  Found user ID: ${userId}`);

  console.log(`\n  Cleaning Auth.js records...`);
  stats.authjs = await cleanupAuthJsRecords(userId);

  console.log(`\n  Cleaning Profile records...`);
  stats.profile = await cleanupProfileRecords(userId);

  console.log(`\n  Cleaning Quota records...`);
  stats.quota = await cleanupQuotaRecords(userId);

  console.log(`\n  Cleaning GPX records...`);
  stats.gpx = await cleanupGpxRecords(userId);

  return stats;
}

test.describe('Cleanup Test Users', () => {

  test('cleanup test user data from DynamoDB', async () => {
    console.log('='.repeat(60));
    console.log('Test User Cleanup');
    console.log('='.repeat(60));
    console.log(`Region:  ${AWS_REGION}`);
    console.log(`Execute: ${EXECUTE}`);
    console.log(`Tables:`);
    console.log(`  - Auth.js:  ${AUTH_AUTHJS_TABLE}`);
    console.log(`  - Profile:  ${AUTH_ELECTRO_TABLE}`);
    console.log(`  - Quota:    ${QUOTA_TABLE}`);
    console.log(`  - GPX:      ${GPX_TABLE}`);
    console.log(`Emails:  ${EMAILS_TO_CLEAN.join(', ')}`);
    console.log('='.repeat(60));

    const totalStats: CleanupStats = { authjs: 0, profile: 0, quota: 0, gpx: 0 };

    for (const email of EMAILS_TO_CLEAN) {
      const stats = await cleanupUser(email);
      totalStats.authjs += stats.authjs;
      totalStats.profile += stats.profile;
      totalStats.quota += stats.quota;
      totalStats.gpx += stats.gpx;
    }

    console.log('\n' + '='.repeat(60));
    console.log('Cleanup Summary');
    console.log('='.repeat(60));
    console.log(`Auth.js records: ${totalStats.authjs}`);
    console.log(`Profile records: ${totalStats.profile}`);
    console.log(`Quota records:   ${totalStats.quota}`);
    console.log(`GPX records:     ${totalStats.gpx}`);
    console.log(`Total:           ${totalStats.authjs + totalStats.profile + totalStats.quota + totalStats.gpx}`);
    console.log('');

    if (!EXECUTE) {
      console.log('[DRY RUN] No changes made. Set CLEANUP_EXECUTE=true to delete.');
    } else {
      console.log('[COMPLETE] Records deleted.');
    }
    console.log('='.repeat(60));

    // Test always passes - cleanup is best effort
    expect(true).toBe(true);
  });
});
