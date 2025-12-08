#!/bin/zsh
AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query "Account" --output text)}

AWS_REGION=${AWS_REGION:-"us-east-1"}
INPUT_FILE="from-aws.tmpl"
OUTPUT_FILE=".env.local"

echo > "$OUTPUT_FILE"
while IFS= read -r line; do
  if echo "$line" | grep -q "^.*=arn:aws:ssm:"; then
    KEY=$(echo "$line" | awk -F= '{print $1}')
    ARN=$(echo "$line" | awk -F= '{print $2}')
    VALUE=$(aws ssm get-parameter --region "$AWS_REGION" --with-decryption --name "$ARN" --query 'Parameter.Value' --output text)
    echo "$KEY=$VALUE" >> "$OUTPUT_FILE"
  else
    echo "$line" >> "$OUTPUT_FILE"
  fi
done < "$INPUT_FILE"