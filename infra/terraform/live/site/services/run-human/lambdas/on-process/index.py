"""
processor Lambda Handler

Triggered by DynamoDB Streams when a UserUpload record changes.
Processes uploads when status changes to "uploaded".

For GPX files: Parses XML, extracts track points, calculates stats
For Photos: Generates thumbnail, extracts EXIF, optional AI tagging (future)

Multi-region coordination:
- Uses conditional DynamoDB update to "claim" work
- Only one region will successfully claim and process each upload
- Tracks processingRegion to know which region handled it
"""

import json
import os
import time
import xml.etree.ElementTree as ET
from io import BytesIO
from math import radians, sin, cos, sqrt, atan2
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

# Initialize clients
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment variables
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', '')
BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', '')
AWS_REGION = os.environ.get('AWS_REGION', 'unknown')


def handler(event, context):
    """
    Process DynamoDB Stream events for UserUpload records.

    Only processes MODIFY events where status changed to "uploaded".
    """
    print(f"Received event: {json.dumps(event)}")
    print(f"Running in region: {AWS_REGION}")

    table = dynamodb.Table(TABLE_NAME)

    for record in event.get('Records', []):
        try:
            process_stream_record(record, table)
        except Exception as e:
            print(f"Error processing record: {e}")
            # Continue processing other records
            continue

    return {
        'statusCode': 200,
        'body': json.dumps('Processing complete')
    }


def process_stream_record(record, table):
    """
    Process a single DynamoDB Stream record.
    """
    event_name = record.get('eventName')

    # Only process MODIFY events (status updates)
    if event_name != 'MODIFY':
        print(f"Skipping {event_name} event")
        return

    new_image = record.get('dynamodb', {}).get('NewImage', {})
    old_image = record.get('dynamodb', {}).get('OldImage', {})

    # Get status values
    new_status = new_image.get('status', {}).get('S', '')
    old_status = old_image.get('status', {}).get('S', '')

    # Only process when status changes TO 'uploaded'
    if new_status != 'uploaded' or old_status == 'uploaded':
        print(f"Skipping: status {old_status} -> {new_status}")
        return

    # Extract record details
    user_id = new_image.get('userId', {}).get('S', '')
    upload_id = new_image.get('uploadId', {}).get('S', '')
    upload_type = new_image.get('uploadType', {}).get('S', '')
    key = new_image.get('key', {}).get('S', '')
    bucket = new_image.get('bucket', {}).get('S', BUCKET_NAME)

    print(f"Processing upload: userId={user_id}, uploadId={upload_id}, type={upload_type}, key={key}")

    # ElectroDB pk/sk format
    pk = new_image.get('pk', {}).get('S', '')
    sk = new_image.get('sk', {}).get('S', '')

    # Try to claim this work using conditional update
    # Only one region will successfully claim
    if not try_claim_processing(table, pk, sk):
        print(f"Another region is processing this upload, skipping: {upload_id}")
        return

    try:
        # Download file from S3
        response = s3.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read()

        # Process based on upload type
        if upload_type == 'gpx':
            result = process_gpx(content)
        elif upload_type == 'photo':
            result = process_photo(content, bucket, key, user_id, upload_id)
        else:
            raise ValueError(f"Unknown upload type: {upload_type}")

        # Write processed output to S3
        processed_key = key.replace('uploads/', 'processed/')

        if result.get('processed_data'):
            s3.put_object(
                Bucket=bucket,
                Key=processed_key,
                Body=result.get('output_data', content),
                ContentType=result.get('content_type', 'application/octet-stream'),
                Tagging=f"owner={user_id}&type={upload_type}"
            )

        # Mark as completed
        mark_completed(table, pk, sk, processed_key, result.get('processed_data', {}))

        print(f"Successfully processed upload: {upload_id}")

    except Exception as e:
        print(f"Error processing upload: {e}")
        update_status(table, pk, sk, 'failed', str(e))
        raise


def try_claim_processing(table, pk, sk):
    """
    Try to claim this upload for processing using conditional update.

    Returns True if we successfully claimed, False if another region got it.
    """
    now = int(time.time() * 1000)

    try:
        table.update_item(
            Key={'pk': pk, 'sk': sk},
            UpdateExpression='SET #status = :processing, processingRegion = :region, processingStartedAt = :startedAt, updatedAt = :updatedAt',
            ConditionExpression='#status = :uploaded AND attribute_not_exists(processingRegion)',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':processing': 'processing',
                ':uploaded': 'uploaded',
                ':region': AWS_REGION,
                ':startedAt': now,
                ':updatedAt': now
            }
        )
        print(f"Successfully claimed processing in region: {AWS_REGION}")
        return True

    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            # Another region already claimed this work
            return False
        else:
            # Some other error - log and re-raise
            print(f"Error claiming processing: {e}")
            raise


def update_status(table, pk, sk, status, message=None):
    """Update the status of an upload record."""
    now = int(time.time() * 1000)

    update_expr = 'SET #status = :status, updatedAt = :updatedAt'
    expr_values = {
        ':status': status,
        ':updatedAt': now
    }

    if message:
        update_expr += ', statusMessage = :message'
        expr_values[':message'] = message

    table.update_item(
        Key={'pk': pk, 'sk': sk},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues=expr_values
    )


def mark_completed(table, pk, sk, processed_key, processed_data):
    """Mark an upload as completed with processed data."""
    now = int(time.time() * 1000)

    table.update_item(
        Key={'pk': pk, 'sk': sk},
        UpdateExpression='SET #status = :status, processedKey = :processedKey, processedData = :processedData, processedAt = :processedAt, updatedAt = :updatedAt',
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues={
            ':status': 'completed',
            ':processedKey': processed_key,
            ':processedData': processed_data,
            ':processedAt': now,
            ':updatedAt': now
        }
    )


def process_gpx(content):
    """
    Process a GPX file.

    Returns:
        dict with processed_data containing track statistics
    """
    try:
        # Parse GPX XML
        root = ET.fromstring(content)

        # GPX namespace
        ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}

        # Find all track points
        track_points = []
        for trkpt in root.findall('.//gpx:trkpt', ns):
            lat = float(trkpt.get('lat', 0))
            lon = float(trkpt.get('lon', 0))

            ele = None
            ele_elem = trkpt.find('gpx:ele', ns)
            if ele_elem is not None and ele_elem.text:
                ele = float(ele_elem.text)

            time_str = None
            time_elem = trkpt.find('gpx:time', ns)
            if time_elem is not None and time_elem.text:
                time_str = time_elem.text

            track_points.append({
                'lat': lat,
                'lon': lon,
                'ele': ele,
                'time': time_str
            })

        if not track_points:
            # Try without namespace (some GPX files don't use namespace)
            for trkpt in root.findall('.//trkpt'):
                lat = float(trkpt.get('lat', 0))
                lon = float(trkpt.get('lon', 0))

                ele = None
                ele_elem = trkpt.find('ele')
                if ele_elem is not None and ele_elem.text:
                    ele = float(ele_elem.text)

                time_str = None
                time_elem = trkpt.find('time')
                if time_elem is not None and time_elem.text:
                    time_str = time_elem.text

                track_points.append({
                    'lat': lat,
                    'lon': lon,
                    'ele': ele,
                    'time': time_str
                })

        if not track_points:
            return {
                'processed_data': {
                    'trackPoints': 0,
                    'error': 'No track points found'
                }
            }

        # Calculate statistics
        total_distance = 0
        total_elevation_gain = 0
        prev_point = None

        min_lat = min(p['lat'] for p in track_points)
        max_lat = max(p['lat'] for p in track_points)
        min_lon = min(p['lon'] for p in track_points)
        max_lon = max(p['lon'] for p in track_points)

        for point in track_points:
            if prev_point:
                # Calculate distance using Haversine formula
                distance = haversine(
                    prev_point['lat'], prev_point['lon'],
                    point['lat'], point['lon']
                )
                total_distance += distance

                # Calculate elevation gain
                if point.get('ele') and prev_point.get('ele'):
                    ele_diff = point['ele'] - prev_point['ele']
                    if ele_diff > 0:
                        total_elevation_gain += ele_diff

            prev_point = point

        # Calculate duration
        duration = 0
        start_time = None
        end_time = None

        if track_points[0].get('time') and track_points[-1].get('time'):
            try:
                start_time = parse_gpx_time(track_points[0]['time'])
                end_time = parse_gpx_time(track_points[-1]['time'])
                duration = int((end_time - start_time).total_seconds())
            except Exception as e:
                print(f"Error parsing times: {e}")

        processed_data = {
            'trackPoints': len(track_points),
            'distance': round(total_distance, 2),  # meters
            'elevation': round(total_elevation_gain, 2),  # meters
            'duration': duration,  # seconds
            'bounds': {
                'minLat': round(min_lat, 6),
                'maxLat': round(max_lat, 6),
                'minLon': round(min_lon, 6),
                'maxLon': round(max_lon, 6)
            }
        }

        if start_time:
            processed_data['startTime'] = start_time.isoformat()
        if end_time:
            processed_data['endTime'] = end_time.isoformat()

        return {
            'processed_data': processed_data,
            'output_data': content,  # Keep original GPX
            'content_type': 'application/gpx+xml'
        }

    except ET.ParseError as e:
        return {
            'processed_data': {
                'error': f'Invalid GPX XML: {str(e)}'
            }
        }


def process_photo(content, bucket, key, user_id, upload_id):
    """
    Process a photo file.

    For now, just copies the file. Future: resize, thumbnail, AI tagging.

    Returns:
        dict with processed_data containing image metadata
    """
    # Basic processing - just get file size
    # Future: Use Pillow for resize, EXIF extraction
    # Future: Use AWS Rekognition for AI tagging

    processed_data = {
        'width': None,  # Would need Pillow
        'height': None,  # Would need Pillow
        'thumbnailKey': None,  # Future: generate thumbnail
        'aiTags': [],  # Future: Rekognition
        'location': None,  # Future: EXIF GPS
        'takenAt': None  # Future: EXIF date
    }

    # Get content type from original
    content_type = 'image/jpeg'  # Default

    return {
        'processed_data': processed_data,
        'output_data': content,
        'content_type': content_type
    }


def haversine(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points
    on the earth (specified in decimal degrees).

    Returns distance in meters.
    """
    R = 6371000  # Earth's radius in meters

    lat1_rad = radians(lat1)
    lat2_rad = radians(lat2)
    delta_lat = radians(lat2 - lat1)
    delta_lon = radians(lon2 - lon1)

    a = sin(delta_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(delta_lon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return R * c


def parse_gpx_time(time_str):
    """Parse GPX timestamp to datetime."""
    # GPX uses ISO 8601 format
    formats = [
        '%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%dT%H:%M:%S.%fZ',
        '%Y-%m-%dT%H:%M:%S%z',
        '%Y-%m-%dT%H:%M:%S.%f%z'
    ]

    for fmt in formats:
        try:
            return datetime.strptime(time_str, fmt)
        except ValueError:
            continue

    raise ValueError(f"Unable to parse time: {time_str}")
