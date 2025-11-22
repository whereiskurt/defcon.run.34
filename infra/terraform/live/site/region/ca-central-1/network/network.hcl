locals {
  # Read parent configuration files to access site and region values
  site_vars   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_vars = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  # Network-specific configuration for ca-central-1
  network = {
    vpc = {
      cidr_block             = "10.1.0.0/16"
      enable_dns_hostnames   = true
      enable_dns_support     = true
      availability_zone_count = 2

      # Public subnets: one per AZ
      public_subnets_cidr = [
        "10.1.1.0/24",
        "10.1.2.0/24"
      ]

      # Private subnets: one per AZ
      private_subnets_cidr = [
        "10.1.10.0/24",
        "10.1.20.0/24"
      ]

      tags = {
        Environment = "production"
        ManagedBy   = "terraform"
      }
    }

    nat_gateway = {
      enabled = true
    }

    vpc_flow_logs = {
      enabled                  = true
      traffic_type             = "ALL"
      max_aggregation_interval = 60
      force_destroy            = true
    }

    vpc_endpoints = {
      enabled = false
    }

    alb = {
      enabled                    = true
      enable_deletion_protection = false
      ssl_policy                 = "ELBSecurityPolicy-TLS13-1-2-2021-06"
      logs_force_destroy         = true
    }

    nlb = {
      enabled                    = false
      enable_deletion_protection = false
      logs_force_destroy         = true
    }
  }
}
