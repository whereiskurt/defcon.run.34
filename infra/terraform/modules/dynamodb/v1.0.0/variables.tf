resource "random_id" "rnd" {
  byte_length = 4
}

variable "site" {
  type = object({
    label         = string
    random_suffix = optional(string, "")
    skip_regions  = optional(list(string), [])
  })
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
}

# Replica stream ARNs passed from the primary region's output.
# Non-primary regions receive this so they don't need a data source lookup.
# Structure: { "table-name" = { "ca-central-1" = "arn:...", ... } }
variable "primary_replica_streams" {
  type    = map(map(string))
  default = {}
}

variable "dynamodb" {
  type = object({
    tables = list(object({
      table_name = string
      replica_regions = list(object({
        label = string
        full  = string
      }))

      # Table type: "standard", "electro", or null for custom
      # When table_type is set, predefined schemas are used
      # When null, attributes and global_secondary_indexes must be provided
      table_type = optional(string, null)

      # Basic configuration
      billing_mode     = optional(string, "PAY_PER_REQUEST")
      hash_key         = optional(string, "pk")
      range_key        = optional(string, "sk")
      stream_enabled   = optional(bool, true)
      stream_view_type = optional(string, "NEW_AND_OLD_IMAGES")

      # Custom schema (only used when table_type is null)
      attributes = optional(list(object({
        name = string
        type = string
      })), [])
      global_secondary_indexes = optional(list(object({
        name            = string
        hash_key        = string
        range_key       = optional(string)
        projection_type = optional(string, "ALL")
      })), [])

      # TTL configuration
      ttl_enabled        = optional(bool, false)
      ttl_attribute_name = optional(string, "")
    }))
  })
  description = "DynamoDB configuration from site level"
}
