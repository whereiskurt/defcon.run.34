# Secrets Management

This directory uses SOPS for encrypted secrets management.

## Quick Start

```bash
# 1. Install sops
brew install sops

# 2. Update .sops.yaml with your KMS key ARN
#    Edit: infra/terraform/live/site/.sops.yaml

# 3. Create your secrets file
cp .secrets.json.example .secrets.json
# Edit .secrets.json with real values

# 4. Encrypt it
sops --encrypt .secrets.json > .secrets.enc.json

# 5. Delete plaintext (important!)
rm .secrets.json

# 6. Commit encrypted file (safe!)
git add .secrets.enc.json
git commit -m "Add encrypted secrets"
```

## How It Works

Terragrunt automatically:
1. Checks for `.secrets.enc.json` (SOPS encrypted)
2. Decrypts on-the-fly using `sops --decrypt`
3. Passes decrypted JSON to Terraform
4. **No plaintext ever touches disk**

## Files

| File | Git? | Description |
|------|------|-------------|
| `.secrets.json.example` | Yes | Template with placeholder values |
| `.secrets.json` | **No** | Plaintext secrets (gitignored, temporary) |
| `.secrets.enc.json` | Yes | SOPS encrypted (safe to commit) |
| `.sops.yaml` | Yes | SOPS config with KMS key |

## Editing Encrypted Secrets

```bash
# Edit directly (decrypts in memory, re-encrypts on save)
sops .secrets.enc.json

# Or decrypt, edit, re-encrypt
sops --decrypt .secrets.enc.json > .secrets.json
# edit .secrets.json
sops --encrypt .secrets.json > .secrets.enc.json
rm .secrets.json
```

## CI/CD

For GitHub Actions, use environment variables instead:

```yaml
env:
  TF_VAR_secret_values: ${{ secrets.TERRAFORM_SECRETS }}
```

Or give the runner KMS access and it will decrypt `.secrets.enc.json` automatically.

## KMS Key Setup

Create a KMS key for SOPS:

```bash
aws kms create-key --description "SOPS secrets encryption"
# Note the KeyId from output

# Create an alias (optional but recommended)
aws kms create-alias \
  --alias-name alias/sops-secrets \
  --target-key-id <KeyId>
```

Update `.sops.yaml`:
```yaml
creation_rules:
  - path_regex: \.secrets(\.enc)?\.json$
    kms: "arn:aws:kms:us-east-1:ACCOUNT_ID:key/KEY_ID"
```

## Alternative: Age Encryption

If you prefer not to use AWS KMS:

```bash
# Generate a key
age-keygen -o age-key.txt
# Keep age-key.txt safe! Back it up securely.

# Update .sops.yaml to use age instead of kms
```
