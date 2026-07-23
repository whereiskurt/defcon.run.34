# Impart Security provider scaffold — INERT until the global/impart unit's
# exclude gate (impart.provider_managed in impart.hcl) is flipped to true.
# See docs/superpowers/specs/2026-07-22-impart-terraform-provider-findings.md
# for the spike findings, resource layout, and Kurt-gates (IMPART token mint,
# sops set, console rule export).

terraform {
  required_providers {
    impart = {
      source  = "impart-security/impart"
      version = "~> 0.15"
    }
  }
}

provider "impart" {
  token = var.impart_api_token
}

# --- Example resources from the provider docs (v0.15.x), kept commented until
# --- the console-created bindings/rules are exported and imported.
#
# A binding is the gateway entry point (hostname/port/base_path) and owns the
# upstream address — this is where origin-use1.defcon.run gets wired as code.
# The two existing console-created bindings (gpx, run) must be
# `terraform import`ed, NOT recreated.
#
# resource "impart_spec" "app" {
#   for_each    = var.apps
#   name        = "${each.key}-defconrun"
#   source_file = "${path.module}/specs/${each.key}.yaml"
#   source_hash = filesha256("${path.module}/specs/${each.key}.yaml")
# }
#
# resource "impart_api_binding" "app" {
#   for_each        = var.apps
#   name            = "${each.key}-defconrun"
#   hostname        = each.value.hostname       # e.g. "gpx.defcon.run"
#   port            = 443
#   base_path       = "/"
#   spec_id         = impart_spec.app[each.key].id
#   upstream_origin = each.value.upstream_origin # e.g. "https://origin-use1.defcon.run"
# }
#
# Rules are opaque content: export the console-built X-Origin-Verify
# require-rule / X-Impart-Edge inject as recipe JSON, commit under rules/.
#
# resource "impart_rule" "origin_verify_require" {
#   name            = "require-x-origin-verify"
#   disabled        = false
#   description     = "Block requests missing the CloudFront X-Origin-Verify secret"
#   content         = file("${path.module}/rules/origin-verify-require.json")
#   blocking_effect = "block"
#   type            = "recipe"
# }
