variable "zone_id" {
  type        = string
  description = "Route53 hosted zone ID for the DNS record"
}

variable "domain_name" {
  type        = string
  description = "Full domain name for the A record (e.g., mqtt.defcon.run)"
}

variable "nlb_dns_name" {
  type        = string
  description = "DNS name of the Network Load Balancer"
}

variable "nlb_zone_id" {
  type        = string
  description = "Hosted zone ID of the Network Load Balancer"
}

variable "region" {
  type = object({
    label = string
    full  = string
  })
  description = "Region configuration: label for set_identifier, full for latency routing"
}
