locals {
  site = {
    label = "dc34"
  }

  dns = {
    zonename   = "defcon.run"
    subdomains = ["email", "run", "strapi", "ctf", "mqtt"]
    ttl        = 300
  }

  email = {
    primary_region = "us-east-1"
    zonenames      = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix    = "s"
    
    make_site_domain      = true
    make_regional_domains = true
    make_domains          = true
    
    smtp_iam_users = [
      "support@run.defcon.run",
      "strapi"
    ]

    fwd_rules = [
      {
        match   = "kurt@defcon.run"
        send_to = "whereiskurt+defcon.run@gmail.com"
      },
      {
        match   = "kurt@run.defcon.run"
        send_to = "whereiskurt+kurt-at-run.defcon.run@gmail.com"
      },
      {
        match   = "run.defcon.run"
        send_to = "whereiskurt+run.defcon.run@gmail.com"
      },
    ]
  }

  waf = {
    enabled  = false
    log_mode = "standard" # standard | realtime
    rule_set = "default"  # optional: which rule set to use
  }
}