# Email Forwarding Configuration

This module supports automatic email forwarding from custom domain addresses to external email addresses (like Gmail) with proper Reply-To and From header handling.

## How It Works

1. **SES Receipt Rules**: When an email arrives at a configured address, SES stores it in S3 and triggers a Lambda function
2. **Lambda Processing**: The Lambda function reads the email, preserves headers, and forwards it with proper Reply-To settings
3. **Reply Handling**: When recipients reply to forwarded emails, the reply goes to the original sender (not the forwarder)

## Configuration

Add the `fwd_rules` variable to your module configuration:

```hcl
module "email" {
  source = "./modules/email/v1.0.0"

  # ... other variables ...

  fwd_rules = [
    {
      from_address = "support@example.com"
      to_address   = "your-gmail@gmail.com"
    },
    {
      from_address = "contact@example.com"
      to_address   = "another-email@gmail.com"
    },
    {
      from_address = "admin@example.com"
      to_address   = "admin-email@outlook.com"
    }
  ]
}
```

## Features

### Proper Header Handling

- **From**: Set to `noreply@{your-domain}` to comply with SES verification requirements, but includes the original sender's name
- **Reply-To**: Set to the original sender's email address so replies go to them
- **X-Original-From**: Custom header preserving the original sender
- **X-Original-To**: Custom header preserving the original recipient
- **Subject**: Prefixed with "Fwd:" to indicate forwarding

### Email Content

The forwarded email includes:
- A header showing the original from/to/subject
- The complete original email body (text and HTML)
- All attachments from the original email
- Preservation of thread context (Message-ID, In-Reply-To, References headers)

## Example Email Flow

1. **Alice** sends email to `support@example.com`
2. **SES** receives the email and triggers the forwarding rule
3. **Lambda** forwards to `your-gmail@gmail.com` with:
   - From: `Alice <noreply@example.com>`
   - Reply-To: `alice@sender.com`
   - Subject: `Fwd: Original Subject`
4. **You** reply to the email in Gmail
5. **Reply goes to**: `alice@sender.com` (the original sender)

## Requirements

- Your custom domain addresses must be part of verified SES domains
- The Lambda function needs permissions to:
  - Read from the S3 bucket where emails are stored
  - Send emails via SES
  - Write to CloudWatch Logs

## Storage

Forwarded emails are stored in S3 under the prefix `forwarding/{email-address}/` for 90 days (default retention policy).

## Monitoring

Check CloudWatch Logs for the Lambda function:
- Log group: `/aws/lambda/{site-label}-email-forwarder`
- Logs include forwarding status, errors, and email metadata
