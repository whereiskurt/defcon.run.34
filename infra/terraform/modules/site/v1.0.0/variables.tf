resource "random_id" "rnd" {
  byte_length = 12
}

variable "site_zonename" {
  type = string
}
variable "site_label" {
  type = string
}

variable "site_subdomains" {
  type = list(string)
}

variable "use_global_waf" {
  type = bool
}
variable "use_global_waf_realtime" {
  type = bool
}