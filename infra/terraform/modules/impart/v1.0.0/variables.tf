variable "impart_api_token" {
  description = "Impart console API token (from .secrets.sops.json impart_api_token)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "apps" {
  description = "Per-app gateway bindings: hostname + upstream origin (origin-<region> alias)"
  type = map(object({
    hostname        = string
    upstream_origin = string
  }))
  default = {}
}
