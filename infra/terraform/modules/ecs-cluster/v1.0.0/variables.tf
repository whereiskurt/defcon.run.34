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

variable "ecs_clusters" {
  type = list(object({
    name            = string
    region          = string
    enable_insights = optional(bool, false)
    cluster_type    = optional(string, "FARGATE") # FARGATE, EC2, EC2_GPU
    namespace_name  = optional(string, "")
  }))
  description = "List of ECS cluster configurations. Each cluster has a name and region. Multiple clusters can be in the same region."
  default     = []
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for service discovery namespace"
}
