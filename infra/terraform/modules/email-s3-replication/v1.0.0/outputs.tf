# Replication status
output "replication_configured" {
  description = "Whether replication was configured for this region"
  value       = local.can_configure_replication
}
