locals {
  email = {
    zonenames   = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix = "s"
  }

  conf = {
    primary_region = "us-east-1"
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
}