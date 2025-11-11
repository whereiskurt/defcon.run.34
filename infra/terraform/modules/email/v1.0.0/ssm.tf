resource "aws_ssm_parameter" "email_zonename" {
  name     = "/${local.ses}/zonename"
  type     = "String"
  value    = var.email.zonename
}

resource "aws_ssm_parameter" "aws_emailuri" {
  name     = "/${local.ses}/awsuri"
  type     = "String"
  value    = "https://email.${var.region.full}.amazonaws.com"
}