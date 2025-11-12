locals {
  email = {
    zonename   = "email.defcon.run"
    smtp_prefix = "s"
  }

  ## use1.email.defcon.run
  use_smtp_region = true 
  
  ## defcon.run
  use_smtp_site = true
}