data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Use site-level random suffix if provided, otherwise use per-region random
  table_suffix = var.site.random_suffix != "" ? var.site.random_suffix : random_id.rnd.hex

  # Primary region is the current region
  is_primary_region = var.region.full == var.dynamodb.replica_regions[0].full

  # Table name with region and suffix
  table_name = "${var.dynamodb.table_name}-${var.site.label}-${local.table_suffix}"

  # Predefined table schemas
  table_schemas = {
    standard = {
      attributes = [
        { name = "gsi1pk", type = "S" },
        { name = "gsi1sk", type = "S" }
      ]
      global_secondary_indexes = [
        {
          name            = "gsi1pk-gsi1sk-index"
          hash_key        = "gsi1pk"
          range_key       = "gsi1sk"
          projection_type = "ALL"
        }
      ]
    }
    electro = {
      attributes = [
        { name = "gsi1pk", type = "S" },
        { name = "gsi1sk", type = "S" },
        { name = "gsi2pk", type = "S" },
        { name = "gsi2sk", type = "S" }
      ]
      global_secondary_indexes = [
        {
          name            = "gsi1pk-gsi1sk-index"
          hash_key        = "gsi1pk"
          range_key       = "gsi1sk"
          projection_type = "ALL"
        },
        {
          name            = "gsi2pk-gsi2sk-index"
          hash_key        = "gsi2pk"
          range_key       = "gsi2sk"
          projection_type = "ALL"
        }
      ]
    }
  }

  # Select schema based on table_type
  selected_schema = var.dynamodb.table_type != null ? local.table_schemas[var.dynamodb.table_type] : {
    attributes               = var.dynamodb.attributes
    global_secondary_indexes = var.dynamodb.global_secondary_indexes
  }

  # Default attributes (pk, sk)
  default_attributes = concat(
    [
      {
        name = var.dynamodb.hash_key
        type = "S"
      }
    ],
    var.dynamodb.range_key != "" ? [
      {
        name = var.dynamodb.range_key
        type = "S"
      }
    ] : []
  )

  # Combine default attributes with schema attributes
  all_attributes = concat(
    local.default_attributes,
    local.selected_schema.attributes
  )

  # Create a unique set of attributes by name
  unique_attributes = {
    for attr in local.all_attributes :
    attr.name => attr
  }

  # Global secondary indexes from selected schema
  global_secondary_indexes = local.selected_schema.global_secondary_indexes

  # Check if global table replication should be enabled
  # Only enable in primary region and only if there are replica regions
  enable_global_table = local.is_primary_region && length(var.dynamodb.replica_regions) > 1
}

# DynamoDB Global Table
# This is only created in the primary region (first region in the list)
# The global table automatically replicates to all specified regions
resource "aws_dynamodb_table" "this" {
  count = local.is_primary_region ? 1 : 0

  name             = local.table_name
  billing_mode     = var.dynamodb.billing_mode
  hash_key         = var.dynamodb.hash_key
  range_key        = var.dynamodb.range_key != "" ? var.dynamodb.range_key : null
  stream_enabled   = var.dynamodb.stream_enabled
  stream_view_type = var.dynamodb.stream_enabled ? var.dynamodb.stream_view_type : null

  # Define all attributes (only those used in keys or indexes)
  dynamic "attribute" {
    for_each = local.unique_attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  # Global Secondary Indexes
  dynamic "global_secondary_index" {
    for_each = local.global_secondary_indexes
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      range_key       = try(global_secondary_index.value.range_key, null)
      projection_type = try(global_secondary_index.value.projection_type, "ALL")
    }
  }

  # TTL configuration
  dynamic "ttl" {
    for_each = var.dynamodb.ttl_enabled ? [1] : []
    content {
      enabled        = true
      attribute_name = var.dynamodb.ttl_attribute_name
    }
  }

  # Replica configuration for Global Tables v2
  dynamic "replica" {
    for_each = local.enable_global_table ? [
      for region in var.dynamodb.replica_regions :
      region if region.full != var.region.full
    ] : []
    content {
      region_name = replica.value.full
    }
  }

  tags = {
    Name        = local.table_name
    Site        = var.site.label
    Region      = var.region.label
    Environment = "production"
  }
}

# Data source to reference the table in non-primary regions
# In non-primary regions, the table is created automatically by the global table
# We just need to reference it
data "aws_dynamodb_table" "this" {
  count = local.is_primary_region ? 0 : 1
  name  = local.table_name

  # Wait for the global table to be replicated
  depends_on = []
}

# Local reference that works in both primary and non-primary regions
locals {
  table_arn = local.is_primary_region ? aws_dynamodb_table.this[0].arn : data.aws_dynamodb_table.this[0].arn
  table_id  = local.is_primary_region ? aws_dynamodb_table.this[0].id : data.aws_dynamodb_table.this[0].name
  stream_arn = local.is_primary_region ? (
    var.dynamodb.stream_enabled ? aws_dynamodb_table.this[0].stream_arn : ""
  ) : (
    var.dynamodb.stream_enabled ? data.aws_dynamodb_table.this[0].stream_arn : ""
  )
}
