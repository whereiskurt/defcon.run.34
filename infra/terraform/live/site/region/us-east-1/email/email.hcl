locals {
  email = {
    zonenames   = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix = "s"
  }

  smtp_credentials = [
    "support@run.defcon.run",
    "run@defcon.run"
  ]

  ## use1.email.defcon.run
  use_smtp_region = true 

  ## defcon.run
  use_smtp_site = true
}