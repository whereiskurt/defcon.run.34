#/bin/bash
export GUID=${GUID:-$(uuidgen)}
export SGUID=$(echo ${GUID:0:8} | tr '[:upper:]' '[:lower:]')

## The state is stored in the bucket and the table is used for locking
## One entry per region supported
export TG_TABLE_CAC1="tf-defcon-run-cac1-${SGUID}"
export TG_BUCKET_CAC1="tf-defcon-run-cac1-${SGUID}"
export TG_BUCKET_USE1="tf-defcon-run-use1-${SGUID}"
export TG_TABLE_USE1="tf-defcon-run-use1-${SGUID}"
export TG_BUCKET_USW2="tf-defcon-run-usw2-${SGUID}"
export TG_TABLE_USW2="tf-defcon-run-usw2-${SGUID}"

unset AWS_ACCESS_KEY_ID                                           
unset AWS_SECRET_ACCESS_KEY                                              
unset AWS_SESSION_TOKEN                                                  
unset AWS_CREDENTIAL_EXPIRATION                                          

### Comment this out if you're not using SSO
##aws sso logout
aws sso login --sso-session=Developer

## Terragrunt uses AWS to setup s3/dynamo and uses the default profile,
## doing this sets makes terragrunt use the terraform profile for it's s3/dynamo creations
$(aws configure export-credentials --profile terraform --format env) 
