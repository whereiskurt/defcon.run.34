"""
on-upload Lambda Handler

Triggered by SNS when a file is uploaded to S3 (uploads/ prefix).
Updates the UserUpload DynamoDB record with status="uploaded".

Multi-region coordination:
- Checks S3 ReplicationStatus to skip replicated objects
- Uses conditional DynamoDB update to prevent duplicate processing
- Only the region where the original upload occurred will process
"""

import json
import os
import time
import urllib.parse
import boto3
from botocore.exceptions import ClientError

# Initialize clients
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment variables
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', '')
AWS_REGION = os.environ.get('AWS_REGION', 'unknown')


def handler(event, context):
    """
    Process SNS notifications for S3 ObjectCreated events.

    Expected event structure:
    {
        "Records": [
            {
                "Sns": {
                    "Message": "{\"Records\": [{\"s3\": {...}}]}"
                }
            }
        ]
    }
    """
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get('Records', []):
        try:
            # Parse SNS message containing S3 event
            sns_message = record.get('Sns', {}).get('Message', '{}')
            s3_event = json.loads(sns_message)

            for s3_record in s3_event.get('Records', []):
                process_s3_record(s3_record, table)

        except Exception as e:
            print(f"Error processing record: {e}")
            # Continue processing other records
            continue

    return {
        'statusCode': 200,
        'body': json.dumps('Processing complete')
    }


def process_s3_record(s3_record, table):
    """
    Process a single S3 event record.

    Expected key format: uploads/{userId}/{uploadType}/{uploadId}.{ext}
    """
    bucket = s3_record['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(s3_record['s3']['object']['key'])
    size = s3_record['s3']['object'].get('size', 0)

    print(f"Processing upload: bucket={bucket}, key={key}, size={size}")

    # Parse the S3 key to extract user info
    # Format: uploads/{userId}/{uploadType}/{uploadId}.{ext}
    parts = key.split('/')

    if len(parts) < 4 or parts[0] != 'uploads':
        print(f"Skipping non-upload key: {key}")
        return

    user_id = parts[1]
    upload_type = parts[2]
    filename = parts[3]

    # Extract uploadId from filename (remove extension)
    upload_id = filename.rsplit('.', 1)[0] if '.' in filename else filename

    print(f"Parsed: userId={user_id}, uploadType={upload_type}, uploadId={upload_id}")

    # Check if this is a replicated object - skip if so
    # Only the source region should process the upload
    try:
        head_response = s3.head_object(Bucket=bucket, Key=key)
        content_type = head_response.get('ContentType', 'application/octet-stream')
        replication_status = head_response.get('ReplicationStatus')

        if replication_status == 'REPLICA':
            print(f"Skipping replicated object (ReplicationStatus=REPLICA): {key}")
            return

        if replication_status:
            print(f"ReplicationStatus: {replication_status}")

    except Exception as e:
        print(f"Error getting object metadata: {e}")
        content_type = 'application/octet-stream'

    # Update DynamoDB record with conditional check
    # ElectroDB key format: $<service>#<attr>_<value> for pk
    # and $<entity>_<version>#<attr>_<value> for sk
    # Note: ElectroDB lowercases attribute names in keys
    pk = f"$run#userid_{user_id}"
    sk = f"$userupload_1#uploadid_{upload_id}"

    # First, check if the record exists and what its current state is
    try:
        existing = table.get_item(Key={'pk': pk, 'sk': sk})
        if 'Item' in existing:
            print(f"Found existing record: status={existing['Item'].get('status')}")
        else:
            print(f"WARNING: No record found with pk={pk}, sk={sk}")
    except Exception as e:
        print(f"Error checking existing record: {e}")

    now = int(time.time() * 1000)  # Milliseconds

    try:
        # Use conditional update to prevent duplicate processing
        # Only update if status is still 'pending'
        response = table.update_item(
            Key={
                'pk': pk,
                'sk': sk
            },
            UpdateExpression='SET #status = :status, fileSize = :fileSize, contentType = :contentType, uploadedAt = :uploadedAt, updatedAt = :updatedAt, uploadRegion = :region',
            ConditionExpression='#status = :pending',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': 'uploaded',
                ':pending': 'pending',
                ':fileSize': size,
                ':contentType': content_type,
                ':uploadedAt': now,
                ':updatedAt': now,
                ':region': AWS_REGION
            },
            ReturnValues='UPDATED_NEW'
        )
        print(f"Updated record: {response.get('Attributes', {})}")

    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            # Record was already processed by another region or is not in 'pending' state
            print(f"Skipping: record already processed or not in pending state (uploadId={upload_id})")
            return
        else:
            print(f"Error updating DynamoDB record: {e}")
            raise

    except Exception as e:
        print(f"Error updating DynamoDB record: {e}")
        raise
