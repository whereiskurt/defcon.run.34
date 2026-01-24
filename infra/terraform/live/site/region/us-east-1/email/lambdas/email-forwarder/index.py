import json
import os
import re
import boto3
import email
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.mime.image import MIMEImage
from email.utils import parseaddr, formataddr
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')
ses = boto3.client('ses')

# Patterns to exclude from forwarding (e.g., e2e test addresses)
# These emails are stored in S3 but not forwarded to avoid inbox flooding
EXCLUDE_PATTERNS = [
    r'^jeanclaude\+.*@',  # jeanclaude+anything@defcon.run (e2e test accounts)
]

def lambda_handler(event, context):
    """
    Forward emails received via SES to configured Gmail/external addresses.
    Sets proper Reply-To and From headers to maintain email thread context.
    """
    # logger.info(f"Event: {json.dumps(event)}")

    # Get forwarding rules from environment
    forwarding_rules = json.loads(os.environ['FORWARDING_RULES'])
    from_domain = os.environ['FROM_DOMAIN']

    # Parse SES event
    ses_record = event['Records'][0]['ses']
    message_id = ses_record['mail']['messageId']
    receipt = ses_record['receipt']

    # Get the recipient that triggered this rule
    recipients = receipt['recipients']
    # logger.info(f"Recipients: {recipients}")

    # Check if any recipient matches exclusion patterns (e.g., e2e test accounts)
    # These emails are stored in S3 for verification but not forwarded
    for recipient in recipients:
        for pattern in EXCLUDE_PATTERNS:
            if re.match(pattern, recipient, re.IGNORECASE):
                logger.info(f"Skipping forward for {recipient} (matches exclusion pattern: {pattern})")
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'message': 'Email excluded from forwarding',
                        'recipient': recipient,
                        'pattern': pattern
                    })
                }

    # Find the forwarding destination using flexible matching
    forward_to = None
    original_recipient = None
    matched_rule = None

    for recipient in recipients:
        # Try exact match first
        if recipient in forwarding_rules:
            forward_to = forwarding_rules[recipient]
            original_recipient = recipient
            matched_rule = recipient
            break

        # Try pattern matching
        for rule_pattern, destination in forwarding_rules.items():
            # Domain matching: if pattern is a domain (no @) and recipient ends with @domain
            if '@' not in rule_pattern and recipient.endswith(f'@{rule_pattern}'):
                forward_to = destination
                original_recipient = recipient
                matched_rule = rule_pattern
                break

            # Contains matching: if pattern is in the recipient
            if rule_pattern in recipient:
                forward_to = destination
                original_recipient = recipient
                matched_rule = rule_pattern
                break

        if forward_to:
            break

    if not forward_to:
        logger.error(f"No forwarding rule found for recipients: {recipients}")
        return {
            'statusCode': 400,
            'body': 'No forwarding rule found'
        }

    logger.info(f"Matched rule '{matched_rule}' for {original_recipient}, forwarding to {forward_to}")

    # Get the original email from S3
    # When Lambda is invoked as a receipt rule action, the S3 action happens first
    # We need to construct the S3 path from the environment variables and message ID
    bucket = os.environ['S3_BUCKET']
    s3_prefix = os.environ.get('S3_KEY_PREFIX', 'forwarding/')

    # Construct the key based on the S3 action configuration in the receipt rule
    # The key format is: {prefix}/{matched_rule}/{messageId}
    # Use matched_rule (not original_recipient) because that's what the SES rule uses for the S3 prefix
    key = f"{s3_prefix}{matched_rule}/{message_id}"

    logger.info(f"Retrieving email from s3://{bucket}/{key}")

    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        email_content = response['Body'].read()

        # Parse the original email
        original_msg = email.message_from_bytes(email_content)

        # Extract original sender
        original_from = original_msg.get('From', '')
        original_sender_name, original_sender_email = parseaddr(original_from)

        # Extract original subject
        original_subject = original_msg.get('Subject', 'No Subject')

        # Create new message
        new_msg = MIMEMultipart('mixed')

        # Set headers for proper reply handling
        # From: use a verified domain address (SES requirement)
        new_msg['From'] = f"{original_sender_name or original_sender_email} <noreply@{from_domain}>"

        # Reply-To: set to the original sender so replies go to them
        new_msg['Reply-To'] = original_from

        # To: the Gmail/external address
        new_msg['To'] = forward_to

        # Subject: include forwarding indicator
        new_msg['Subject'] = f"Fwd: {original_subject}"

        # Add custom headers to preserve original information
        new_msg['X-Original-From'] = original_from
        new_msg['X-Original-To'] = original_recipient
        new_msg['X-Forwarded-By'] = 'SES Email Forwarder'

        # Preserve other headers
        for header in ['Date', 'Message-ID', 'In-Reply-To', 'References']:
            if header in original_msg:
                new_msg[header] = original_msg[header]

        # Build the email body
        body_text = f"""
This email was automatically forwarded from {original_recipient}

Original From: {original_from}
Original To: {original_recipient}
Original Subject: {original_subject}

{'='*60}

"""

        # Extract and forward the original content
        if original_msg.is_multipart():
            # Handle multipart messages
            for part in original_msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get("Content-Disposition", ""))
                content_id = part.get("Content-ID", "")

                if content_type == "text/plain" and "attachment" not in content_disposition:
                    body_text += part.get_payload(decode=True).decode('utf-8', errors='ignore')
                elif content_type == "text/html" and "attachment" not in content_disposition:
                    # Add HTML part
                    html_content = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                    new_msg.attach(MIMEText(html_content, 'html'))
                elif content_type.startswith('image/') and content_id:
                    # Handle inline images with Content-ID (used in HTML)
                    image_data = part.get_payload(decode=True)
                    image_subtype = content_type.split('/')[-1]  # e.g., 'png', 'jpeg'
                    mime_image = MIMEImage(image_data, _subtype=image_subtype)
                    # Preserve the Content-ID so HTML references work
                    mime_image.add_header('Content-ID', content_id)
                    if part.get_filename():
                        mime_image.add_header('Content-Disposition', 'inline', filename=part.get_filename())
                    new_msg.attach(mime_image)
                elif "attachment" in content_disposition or content_type.startswith('image/'):
                    # Forward regular attachments (including images without Content-ID)
                    attachment = MIMEApplication(part.get_payload(decode=True))
                    attachment.add_header('Content-Disposition', 'attachment',
                                        filename=part.get_filename())
                    new_msg.attach(attachment)
        else:
            # Handle simple text messages
            body_text += original_msg.get_payload(decode=True).decode('utf-8', errors='ignore')

        # Add text part
        new_msg.attach(MIMEText(body_text, 'plain'))

        # Send the email
        response = ses.send_raw_email(
            Source=new_msg['From'],
            Destinations=[forward_to],
            RawMessage={'Data': new_msg.as_string()}
        )

        logger.info(f"Fwd {original_recipient} to {forward_to} successfully: {response['MessageId']}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Email forwarded successfully',
                'messageId': response['MessageId']
            })
        }

    except Exception as e:
        logger.error(f"Error forwarding email: {str(e)}", exc_info=True)
        raise
