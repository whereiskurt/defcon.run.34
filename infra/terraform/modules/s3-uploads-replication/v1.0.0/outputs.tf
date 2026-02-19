# Replication status
output "replication_configured" {
  description = "Map indicating if replication was configured for each upload"
  value = {
    for name, _ in local.active_replication : name => true
  }
}
