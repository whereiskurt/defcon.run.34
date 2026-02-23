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

variable "waffaw" {
  description = "WAF testing platform configuration"
  type = object({
    enabled           = bool
    ec2_count         = number
    ec2_max_count     = number
    ec2_instance_type = string
    ec2_use_spot      = bool
    ec2_multi_eni     = bool
    ecs_desired_count = number
    ecs_use_spot      = bool
    ecs_task_cpu      = number
    ecs_task_memory   = number
  })
  default = {
    enabled           = false
    ec2_count         = 0
    ec2_max_count     = 10
    ec2_instance_type = "t3.medium"
    ec2_use_spot      = true
    ec2_multi_eni     = false
    ecs_desired_count = 0
    ecs_use_spot      = true
    ecs_task_cpu      = 1024
    ecs_task_memory   = 2048
  }
}

variable "image_uri" {
  type        = string
  description = "Waffaw agent container image in {site_label}-waffaw:{tag} format (e.g. dc34-waffaw:1.0.0). The module constructs the full regional ECR URI."
  default     = ""
}
