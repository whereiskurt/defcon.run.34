locals {
  site_label    = "dc34"

  site_zonename = "defcon.run"
  site_subdomains = ["email", "webapp", "ctf", "strapi", "mqtt"]

  ## When use_global_waf is true, applications CFD will use this globally configured WAF webacl.
  use_global_waf = true
  
  ## When false it will use just cloud watch without kinesis
  use_global_waf_realtime = false
}