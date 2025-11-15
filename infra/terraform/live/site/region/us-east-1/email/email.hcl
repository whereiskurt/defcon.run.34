locals {
  email = {
    zonenames   = ["email.defcon.run", "run.defcon.run"]
    smtp_prefix = "s"
  }

  smtp_iam_users = [
    "support@run.defcon.run",
    "run@defcon.run"
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