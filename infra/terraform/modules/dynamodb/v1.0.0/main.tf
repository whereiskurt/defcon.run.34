data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Use site-level random suffix if provided, otherwise use per-region random
  table_suffix = var.site.random_suffix != "" ? var.site.random_suffix : random_id.rnd.hex

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
        { name = "gsi2sk", type = "S" },
        { name = "gsi3pk", type = "S" },
        { name = "gsi3sk", type = "S" }
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
        },
        {
          name            = "gsi3pk-gsi3sk-index"
          hash_key        = "gsi3pk"
          range_key       = "gsi3sk"
          projection_type = "ALL"
        }
      ]
    }
    nextauth = {
      attributes = [
        { name = "GSI1PK", type = "S" },
        { name = "GSI1SK", type = "S" }
      ]
      global_secondary_indexes = [
        {
          name            = "GSI1"
          hash_key        = "GSI1PK"
          range_key       = "GSI1SK"
          projection_type = "ALL"
        }
      ]
    }
  }

  # Create a map of tables with computed properties
  tables = {
    for table in var.dynamodb.tables : table.table_name => {
      config              = table
      table_name          = "${table.table_name}"
      is_primary_region   = var.region.full == table.replica_regions[0].full
      enable_global_table = var.region.full == table.replica_regions[0].full && length(table.replica_regions) > 1

      # Select schema based on table_type, then append any per-table extras.
      # Extras let a table_type entry declare additional attributes / GSIs
      # (e.g. run-human-electro's runnerCode-index) without duplicating the
      # base schema. Custom (table_type = null) entries still work because
      # the base is `[]` and `table.attributes`/`table.global_secondary_indexes`
      # default to `[]`.
      selected_schema = {
        attributes = concat(
          table.table_type != null ? local.table_schemas[table.table_type].attributes : [],
          table.attributes
        )
        global_secondary_indexes = concat(
          table.table_type != null ? local.table_schemas[table.table_type].global_secondary_indexes : [],
          table.global_secondary_indexes
        )
      }

      # Default attributes (pk, sk)
      default_attributes = concat(
        [
          {
            name = table.hash_key
            type = "S"
          }
        ],
        table.range_key != "" ? [
          {
            name = table.range_key
            type = "S"
          }
        ] : []
      )
    }
  }

  # Filter tables to only include those that should exist in the current region
  tables_in_region = {
    for name, table in local.tables : name => table
    if contains([for r in table.config.replica_regions : r.full], var.region.full)
  }

  # Compute unique attributes and GSIs for each table
  table_configs = {
    for name, table in local.tables_in_region : name => {
      table_name          = table.table_name
      is_primary_region   = table.is_primary_region
      enable_global_table = table.enable_global_table
      config              = table.config

      # Combine default attributes with schema attributes
      all_attributes = concat(
        table.default_attributes,
        table.selected_schema.attributes
      )

      # Create a unique set of attributes by name
      unique_attributes = {
        for attr in concat(table.default_attributes, table.selected_schema.attributes) :
        attr.name => attr
      }

      # Global secondary indexes from selected schema
      global_secondary_indexes = table.selected_schema.global_secondary_indexes
    }
  }
}

# DynamoDB Global Table
# This is only created in the primary region (first region in the list)
# The global table automatically replicates to all specified regions
resource "aws_dynamodb_table" "this" {
  for_each = {
    for name, config in local.table_configs :
    name => config if config.is_primary_region
  }

  name             = each.value.table_name
  billing_mode     = each.value.config.billing_mode
  hash_key         = each.value.config.hash_key
  range_key        = each.value.config.range_key != "" ? each.value.config.range_key : null
  stream_enabled   = each.value.config.stream_enabled
  stream_view_type = each.value.config.stream_enabled ? each.value.config.stream_view_type : null

  # Define all attributes (only those used in keys or indexes)
  dynamic "attribute" {
    for_each = each.value.unique_attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  # Global Secondary Indexes
  dynamic "global_secondary_index" {
    for_each = each.value.global_secondary_indexes
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      range_key       = try(global_secondary_index.value.range_key, null)
      projection_type = try(global_secondary_index.value.projection_type, "ALL")
    }
  }

  # TTL configuration
  dynamic "ttl" {
    for_each = each.value.config.ttl_enabled ? [1] : []
    content {
      enabled        = true
      attribute_name = each.value.config.ttl_attribute_name
    }
  }

  # Point-in-time recovery
  point_in_time_recovery {
    enabled = true
  }

  # Replica configuration for Global Tables v2
  dynamic "replica" {
    for_each = each.value.enable_global_table ? [
      for region in each.value.config.replica_regions :
      region if region.full != var.region.full && !contains(var.site.skip_regions, region.full)
    ] : []
    content {
      region_name = replica.value.full
    }
  }

  tags = {
    Name        = each.value.table_name
    TableType   = each.key
    Site        = var.site.label
    Region      = var.region.label
    Environment = "production"
  }
}

# Unified output map for tables
# Primary regions use the aws_dynamodb_table resource attributes directly.
# Non-primary regions use computed ARNs and replica stream ARNs passed from
# the primary region via var.primary_replica_streams (no data source needed).
locals {
  tables_output = {
    for name, config in local.table_configs : name => {
      table_name = config.table_name
      table_arn = config.is_primary_region ? (
        aws_dynamodb_table.this[name].arn
        ) : (
        "arn:aws:dynamodb:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:table/${config.table_name}"
      )
      table_id = config.is_primary_region ? (
        aws_dynamodb_table.this[name].id
        ) : (
        config.table_name
      )
      stream_arn = config.is_primary_region ? (
        config.config.stream_enabled ? aws_dynamodb_table.this[name].stream_arn : ""
        ) : (
        try(var.primary_replica_streams[name][var.region.full], "")
      )
      is_primary_region = config.is_primary_region
    }
  }
}
