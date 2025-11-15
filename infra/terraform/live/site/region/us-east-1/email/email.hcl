locals {
  smtp_iam_users = [
    "run@use1.defcon.run"
  ]

  fwd_rules = [
    {
      match   = "use1.defcon.run"
      send_to = "whereiskurt+use1.defcon.run@gmail.com"
    },
  ]
}