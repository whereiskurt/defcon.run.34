## aws-nuke config for wiping fork account (__NUKE_ACCOUNT_ID__)
  - "__SAFETY_ACCOUNT_ID__"
  - "__SAFETY_ACCOUNT_ID_OTHER__"

accounts:
  "__NUKE_ACCOUNT_ID__":
    alias: "__NUKE_ACCOUNT_ALIAS__"

regions:
  - us-east-1
  - ca-central-1
  - ap-southeast-1
  - global

resource-types:
  includes:
    - S3Bucket
    - S3Object
    - DynamoDBTable
    - DynamoDBTableItem
    - KMSKey
    - KMSAlias

presets:
  common:
    filters:
      KMSAlias:
        - type: glob
          value: "alias/aws/*"
      KMSKey:
        - type: glob
          property: AliasName
          value: "alias/aws/*"
      IAMRole:
        - "OrganizationAccountAccessRole"
      IAMRolePolicyAttachment:
        - type: glob
          value: "OrganizationAccountAccessRole -> *"
