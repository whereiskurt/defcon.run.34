locals {
  site = { 
    label = "dc34"
  }

  dns = {
    zonename   = "defcon.run"
    subdomains  = ["run", "ctf", "strapi", "mqtt", "email"]
    ttl         = 300
  }
  waf = {
    enabled     = false
    log_mode    = "standard"  # standard | realtime
    rule_set    = "default"   # optional: which rule set to use
  }
}