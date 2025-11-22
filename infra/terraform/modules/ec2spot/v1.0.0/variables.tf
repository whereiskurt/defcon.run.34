variable "site" {
  type = object({
    label         = string
    random_suffix = string
  })
  description = "Site configuration"
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
  description = "Region configuration"
}

variable "dns" {
  type = object({
    zonename   = string
    subdomains = list(string)
    ttl        = number
  })
  description = "DNS configuration"
}

variable "ec2spots" {
  type = list(object({
    count                  = number
    region                 = string
    zone_name              = string
    create_dns_records     = bool
    instance_type          = string
    spot_price_multiplier  = optional(number, 1.00)
    spot_price_offset      = optional(number, 0.0005)
    block_duration_minutes = optional(number, 0)
    ec2key_name_prefix     = optional(string, "ec2spot")
    ec2key_filename_prefix = optional(string, "ec2spot")
    githubdeploykey        = optional(string, "NOT_SET")
    user_data              = optional(string, "")
  }))
  description = "List of EC2 spot instance configurations per region"
  default     = []
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where EC2 spot instances will be created"
}

variable "public_subnets" {
  type        = list(string)
  description = "List of public subnet IDs"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones"
}

variable "zone_map" {
  type = map(object({
    zone_id      = string
    name         = string
    name_servers = list(string)
  }))
  description = "Map of DNS zones"
  default     = {}
}
