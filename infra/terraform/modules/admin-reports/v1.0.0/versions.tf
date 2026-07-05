terraform {
  # import{} blocks with for_each require Terraform >= 1.7 (repo runs 1.14).
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}
