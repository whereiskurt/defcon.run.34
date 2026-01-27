import { S3Client, ListObjectsV2Command, GetObjectCommand, type S3ClientConfig } from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const EMAIL_PREFIX = 'inbox/defcon.run/';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60; // 120 seconds max wait (2 minutes)

// SSM parameter path for bucket name
const SITE_LABEL = 'dc34';
const REGION_LABEL = 'use1';
const BUCKET_SSM_PARAM = `/${SITE_LABEL}/ses/s3/${REGION_LABEL}/bucket_name`;

interface EmailResult {
  code: string;
  messageId: string;
  receivedAt: Date;
}

async function getBucketName(region: string = 'us-east-1'): Promise<string> {
  const ssm = new SSMClient({ region });
  const command = new GetParameterCommand({
    Name: BUCKET_SSM_PARAM,
  });
  const response = await ssm.send(command);
  if (!response.Parameter?.Value) {
    throw new Error(`SSM parameter ${BUCKET_SSM_PARAM} not found or empty`);
  }
  return response.Parameter.Value;
}

export async function waitForVerificationEmail(
  recipientEmail: string,
  afterTimestamp: Date,
  s3Config?: S3ClientConfig
): Promise<EmailResult> {
  const s3 = new S3Client(s3Config || { region: 'us-east-1' });
  const bucketName = await getBucketName('us-east-1');
  console.log(`Using S3 bucket: ${bucketName}`);

  console.log(`Polling S3 for verification email to ${recipientEmail}...`);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    try {
      // List recent objects in the inbox
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: EMAIL_PREFIX,
        MaxKeys: 50,
      });

      const listResult = await s3.send(listCommand);
      const objects = listResult.Contents || [];

      // Filter for objects created after our timestamp
      const recentObjects = objects
        .filter(obj => obj.LastModified && obj.LastModified > afterTimestamp)
        .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));

      for (const obj of recentObjects) {
        if (!obj.Key) continue;

        // Fetch the email content
        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: obj.Key,
        });

        const emailResult = await s3.send(getCommand);
        const emailBody = await emailResult.Body?.transformToString();

        if (!emailBody) continue;

        // Check if this email is for our recipient
        if (!emailBody.toLowerCase().includes(recipientEmail.toLowerCase())) {
          continue;
        }

        // Extract 6-digit code from Subject line
        // Subject format: "123456" (just the code, for iOS click-through)
        const subjectMatch = emailBody.match(/Subject:\s*(\d{6})/);
        if (subjectMatch) {
          return {
            code: subjectMatch[1],
            messageId: obj.Key.replace(EMAIL_PREFIX, ''),
            receivedAt: obj.LastModified || new Date(),
          };
        }

        // Also check in body for the code pattern
        // Body format: "<strong>123456</strong>"
        const bodyMatch = emailBody.match(/<strong>(\d{6})<\/strong>/);
        if (bodyMatch) {
          return {
            code: bodyMatch[1],
            messageId: obj.Key.replace(EMAIL_PREFIX, ''),
            receivedAt: obj.LastModified || new Date(),
          };
        }
      }
    } catch (error) {
      console.error(`Poll attempt ${attempt + 1} failed:`, error);
    }

    if (attempt < MAX_POLL_ATTEMPTS - 1) {
      process.stdout.write('.');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  throw new Error(`No verification email found for ${recipientEmail} after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000} seconds`);
}
