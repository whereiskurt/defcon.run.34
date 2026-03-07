output "blocklist_bucket_name" {
  description = "Name of the MQTT blocklist S3 bucket"
  value       = aws_s3_bucket.mqtt_blocklist.bucket
}

output "blocklist_bucket_arn" {
  description = "ARN of the MQTT blocklist S3 bucket"
  value       = aws_s3_bucket.mqtt_blocklist.arn
}

output "logs_bucket_name" {
  description = "Name of the MQTT logs S3 bucket"
  value       = aws_s3_bucket.mqtt_logs.bucket
}

output "logs_bucket_arn" {
  description = "ARN of the MQTT logs S3 bucket"
  value       = aws_s3_bucket.mqtt_logs.arn
}

output "dns_fqdn" {
  description = "FQDN of the MQTT DNS record"
  value       = module.nlb_dns.fqdn
}
