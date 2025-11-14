locals {
  email = {
    zonenames   = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix = "s"
  }

  smtp_credentials = [
    "support@run.defcon.run",
    "run@defcon.run"
  ]

  email_forwarding = [
    {
      from_address = "kurt@defcon.run"
      to_address   = "whereiskurt+defcon.run@gmail.com"
    },
    {
      from_address = "kurt@run.defcon.run"
      to_address   = "whereiskurt+run.defcon.run@gmail.com"
    }
  ]
  ## use1.email.defcon.run
  use_smtp_region = true 

  ## defcon.run
  use_smtp_site = true
}