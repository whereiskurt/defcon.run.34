terraform {
  # import{} blocks with for_each require Terraform >= 1.7 (repo runs 1.14).
  required_version = ">= 1.7"

  # NOTE: required_providers is intentionally omitted. This module is the ROOT of a
  # terragrunt unit whose `include "providers"` generates a provider.tf carrying its
  # own required_providers block; declaring a second one here errors with "Duplicate
  # required providers configuration" under terragrunt (bare `terraform validate`
  # does not surface it). Matches the cloudtrail/network unit-root modules.
}
