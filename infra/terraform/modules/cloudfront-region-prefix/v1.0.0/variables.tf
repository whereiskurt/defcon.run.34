variable "name_suffix" {
  description = "Suffix for the CloudFront Function names (e.g. site/region label), to keep them unique per distribution/site."
  type        = string
}

variable "served_regions" {
  description = <<-EOT
    Region short-labels this deploy actually SERVES (has an ALB + app for),
    e.g. ["use1"] today, ["use1","cac1","apse1"] once cac1/apse1 un-skip.
    A path is only left un-prefixed if its first segment is one of these, and
    the country map can only resolve to one of these. Deriving geo behavior:
    the geo lookup turns on automatically when length > 1 (override via
    var.geo_enabled).
  EOT
  type        = list(string)
}

variable "default_region" {
  description = "Region short-label used as the fallback, and as the ONLY target on single-region deploys (e.g. \"use1\")."
  type        = string
  default     = "use1"
}

variable "country_region_map" {
  description = <<-EOT
    Country-code (ISO-3166-1 alpha-2, as CloudFront-Viewer-Country reports it)
    -> served region-label. The geo seam. Default {} means "default region for
    everyone" even when geo is enabled. Populate when cac1/apse1 serve, e.g.
    { CA = "cac1", SG = "apse1", MY = "apse1", ... }. Values that are not in
    served_regions are ignored at runtime.
  EOT
  type        = map(string)
  default     = {}
}

variable "cookie_name" {
  description = "Name of the sticky-region cookie set on multi-region deploys."
  type        = string
  default     = "dcr_region"
}

variable "geo_enabled" {
  description = <<-EOT
    Force the geo/cookie lookup on (true) or off (false). Default null =
    derive from served_regions (on when >1 region serves). Set false to force
    the cheap single-region override (always prefix the default region, no
    cookie/country lookup) even if the config lists more regions.
  EOT
  type        = bool
  default     = null
}

variable "enabled" {
  description = "Master switch. false creates NO functions (function ARNs come back empty) — for deploys that prefix another way and want to override this entirely."
  type        = bool
  default     = true
}
