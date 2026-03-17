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

variable "enable_logging" {
  type        = bool
  description = "Enable CloudWatch logging for ECS containers. When false, uses 'none' log driver."
  default     = true
}

variable "ecs_tasks" {
  type = list(object({
    name               = string
    regions            = list(string)
    cluster_name       = string
    task_cpu           = optional(number, 512)
    task_memory        = optional(number, 1024)
    network_mode       = optional(string, "awsvpc")
    task_role_arn      = optional(string, "")
    execution_role_arn = optional(string, "")

    containers = list(object({
      name               = string
      image              = string
      cpu                = optional(number, 256)
      memory             = optional(number, 512)
      memory_reservation = optional(number, 256)
      essential          = optional(bool, true)
      command            = optional(list(string), [])

      # Security: Read-only root filesystem (recommended for security)
      readonly_root_filesystem = optional(bool, true)

      # tmpfs mounts for containers that need write access with readonly root filesystem
      # Common paths: /tmp, /var/run, /var/cache/nginx
      tmpfs_mounts = optional(list(object({
        container_path = string
        size           = optional(number, 64) # Size in MiB
      })), [])

      environment = optional(list(object({
        name  = string
        value = string
      })), [])

      secrets = optional(list(object({
        name      = string
        valueFrom = string
      })), [])

      port_mappings = optional(list(object({
        container_port = number
        host_port      = number
        protocol       = optional(string, "tcp")
      })), [])

      depends_on = optional(list(object({
        container_name = string
        condition      = string # START, COMPLETE, SUCCESS, HEALTHY
      })), [])

      health_check = optional(object({
        command      = list(string)
        interval     = optional(number, 30)
        timeout      = optional(number, 5)
        retries      = optional(number, 3)
        start_period = optional(number, 0)
      }), null)

      log_stream_prefix = optional(string, "ecs")
    }))
  }))
  description = "List of ECS task definitions"
  default     = []
}
