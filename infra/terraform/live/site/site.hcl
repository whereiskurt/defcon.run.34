locals {
  site = {
    label         = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
  }

  dns = {
    zonename   = "defcon.run"
    subdomains = ["email", "run", "strapi", "ctf", "mqtt"]
    ttl        = 300
  }

  email = {
    primary_region = "us-east-1"
    zonenames      = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix    = "s"

    make_site_domain      = true
    make_regional_domains = true
    make_domains          = true

    # Cross-region S3 bucket replication
    # Each region will replicate its bucket to all other regions in this list
    replica_regions = [
      {
        label = "use1"
        full  = "us-east-1"
      },
      {
        label = "cac1"
        full  = "ca-central-1"
      }
    ]

    smtp_iam_users = [
      "support@run.defcon.run",
      "strapi"
    ]

    fwd_rules = [
      {
        match   = "kurt@defcon.run"
        send_to = "whereiskurt+defcon.run@gmail.com"
      },
      {
        match   = "kurt@run.defcon.run"
        send_to = "whereiskurt+kurt-at-run.defcon.run@gmail.com"
      },
      {
        match   = "run.defcon.run"
        send_to = "whereiskurt+run.defcon.run@gmail.com"
      },
    ]
  }

  waf = {
    enabled  = false
    log_mode = "standard" # standard | realtime
    rule_set = "default"  # optional: which rule set to use
  }

  cloudfront = {
    enabled = true

    # Domains that will be served by CloudFront
    # These will be combined with dns.zonename to create full domains
    # e.g., "run" becomes "run.defcon.run"
    domains = ["run", "mqtt"]

    # Regions that will provide ALB and S3 bucket origins
    # Each region will contribute:
    # - An ALB origin for /{region_label}/*
    # - An S3 bucket origin for /{region_label}/assets/*
    regions = [
      {
        label = "use1"
        full  = "us-east-1"
      },
      {
        label = "cac1"
        full  = "ca-central-1"
      }
    ]

    # CloudFront logging configuration
    logging = {
      enabled = true
      include_cookies = true
    }

    # Price class for CloudFront distribution
    # Options: PriceClass_All, PriceClass_200, PriceClass_100
    price_class = "PriceClass_100"
  }

  dynamodb = {
    table_name = "dc34-app-data"

    # Table type: "standard" or "electro"
    # standard: 1 GSI (gsi1pk-gsi1sk-index)
    # electro: 2 GSIs (gsi1pk-gsi1sk-index, gsi2pk-gsi2sk-index)
    # Set to null to use custom attributes and indexes
    table_type = "electro"

    # Multi-region global table configuration
    # The first region in the list is the primary region where the table is created
    # All other regions are replicas
    replica_regions = [
      {
        label = "use1"
        full  = "us-east-1"
      },
      {
        label = "cac1"
        full  = "ca-central-1"
      }
    ]

    # Table configuration
    billing_mode     = "PAY_PER_REQUEST"
    hash_key         = "pk"
    range_key        = "sk"
    stream_enabled   = true
    stream_view_type = "NEW_AND_OLD_IMAGES"

    # TTL configuration (optional)
    ttl_enabled        = false
    ttl_attribute_name = ""
  }
}