import json
import os
import boto3
import email
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.utils import parseaddr, formataddr
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')
ses = boto3.client('ses')

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

    # Find the forwarding destination
    forward_to = None
    original_recipient = None
    for recipient in recipients:
        if recipient in forwarding_rules:
            forward_to = forwarding_rules[recipient]
            original_recipient = recipient
            break

    if not forward_to:
        logger.error(f"No forwarding rule found for recipients: {recipients}")
        return {
            'statusCode': 400,
            'body': 'No forwarding rule found'
        }

    # logger.info(f"Forwarding email from {original_recipient} to {forward_to}")

    # Get the original email from S3
    # When Lambda is invoked as a receipt rule action, the S3 action happens first
    # We need to construct the S3 path from the environment variables and message ID
    bucket = os.environ['S3_BUCKET']
    s3_prefix = os.environ.get('S3_KEY_PREFIX', 'forwarding/')

    # Construct the key based on the S3 action configuration in the receipt rule
    # The key format is: {prefix}/{from_address}/{messageId}
    key = f"{s3_prefix}{original_recipient}/{message_id}"

    # logger.info(f"Retrieving email from s3://{bucket}/{key}")

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

                if content_type == "text/plain" and "attachment" not in content_disposition:
                    body_text += part.get_payload(decode=True).decode('utf-8', errors='ignore')
                elif content_type == "text/html" and "attachment" not in content_disposition:
                    # Add HTML part
                    html_content = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                    new_msg.attach(MIMEText(html_content, 'html'))
                elif "attachment" in content_disposition or content_type.startswith('image/'):
                    # Forward attachments
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
