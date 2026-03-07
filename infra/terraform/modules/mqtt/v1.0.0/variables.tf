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

variable "nlb_dns_name" {
  type        = string
  description = "DNS name of the Network Load Balancer"
}

variable "nlb_zone_id" {
  type        = string
  description = "Hosted zone ID of the Network Load Balancer"
}

variable "mqtt_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for mqtt.defcon.run"
}

variable "dns_zonename" {
  type        = string
  description = "Base DNS zone name (e.g., defcon.run)"
}
