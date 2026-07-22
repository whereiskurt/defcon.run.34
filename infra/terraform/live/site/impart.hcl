# Impart Security onboarding — the ONLY file to touch for rollout state changes.
#
# Read by:
#   global/cloudfront            -> per-app gateway origins + behavior targeting
#   region/us-east-1/network     -> ALB security-group ingress for Impart egress IPs
#   region/us-east-1/ecs-service -> optional X-Impart-Edge listener-rule enforcement
#
# Per-app rollout states (see docs/superpowers/specs/2026-07-21-impart-cloudfront-origins-design.md):
#   off    - Impart origin exists on the distro but nothing targets it (inert)
#   canary - only canary_path (default /use1/api/health) routes CF -> Impart -> ALB
#   on     - default + /{region} + /{region}/* app behaviors route via Impart
#
# Rollback at any point = flip state back. In-place UpdateDistribution, ~2-5 min.
#
# Secrets (in .secrets.sops.json, both optional — absent means "no header"):
#   impart_origin_verify - CloudFront injects X-Origin-Verify toward the gateways
#   impart_edge_header   - value Impart injects as X-Impart-Edge toward our ALB

locals {
  impart = {
    enabled = true

    # Impart gateway egress IPs allowed to reach the ALB on 443
    # (alongside the CloudFront origin-facing prefix list — both stay open)
    alb_ingress_cidrs = [
      # us-east-1 primary
      "44.196.43.182/32",
      "44.218.171.39/32",
      "54.234.154.163/32",
      "54.83.239.56/32",
      # us-west-1 failover
      "13.56.35.105/32",
      "52.8.178.200/32",
      "52.9.193.103/32",
      "54.177.54.69/32",
    ]

    origins = {
      gpx = {
        dns_name = "gpx-defconrun-seoks0.impartcloud.net"
        state    = "on" # off | canary | on
        # canary_path = "/use1/api/health"   # default; override per app if needed
        # ALB-side X-Impart-Edge enforcement. Only takes effect when state = "on"
        # (in off/canary most traffic reaches the ALB directly, without the
        # header, and would be 403'd). Flip on only after "on" has soaked.
        enforce_alb_header = false
      }
      run = {
        dns_name           = "run-defconrun-n1xdxk.impartcloud.net"
        state              = "off"
        enforce_alb_header = false
      }
    }
  }
}
