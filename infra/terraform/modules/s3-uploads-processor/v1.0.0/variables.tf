variable "site" {
  description = "Site-level configuration"
  type = object({
    label         = string
    random_suffix = string
    skip_regions  = list(string)
  })
}

variable "region" {
  description = "Region configuration"
  type = object({
    label = string
    full  = string
  })
}

variable "upload_processors" {
  description = "Upload processor configurations"
  type = list(object({
    name         = string       # Processor identifier, e.g., "run-human"
    service_name = string       # Associated ECS service name
    regions      = list(string) # Deployment regions (full names)

    # Reference to user_uploads bucket (by name)
    user_upload_name = string

    # Reference to DynamoDB table (by table_name)
    dynamodb_table_ref = string

    # Lambda configuration - source_path is required, points to directory with index.py
    on_upload_lambda = object({
      source_path = string # Path to Lambda source directory
      timeout     = optional(number, 30)
      memory_size = optional(number, 256)
    })

    on_process_lambda = object({
      source_path = string # Path to Lambda source directory
      timeout     = optional(number, 300)
      memory_size = optional(number, 1024)
    })
  }))
  default = []
}

# Dependency outputs from s3-uploads module
variable "s3_uploads_buckets" {
  description = "Bucket outputs from s3-uploads module"
  type = map(object({
    name   = string
    arn    = string
    region = string
  }))
  default = {}
}

# Dependency outputs from dynamodb module
variable "dynamodb_tables" {
  description = "Table outputs from dynamodb module"
  type = map(object({
    table_name        = string
    table_arn         = string
    table_id          = string
    stream_arn        = string
    is_primary_region = bool
  }))
  default = {}
}
