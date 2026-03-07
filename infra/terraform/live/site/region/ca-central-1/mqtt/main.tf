# MQTT regional resources: S3 buckets and NLB DNS records

# --- S3 Blocklist Bucket (INFRA-06) ---

resource "aws_s3_bucket" "mqtt_blocklist" {
  bucket = "mqtt-blocklist-${var.region.label}-${var.site.label}-${var.site.random_suffix}"
  tags = {
    Name    = "mqtt-blocklist"
    Service = "run-mqtt"
    Region  = var.region.label
    Site    = var.site.label
  }
}

resource "aws_s3_bucket_public_access_block" "mqtt_blocklist" {
  bucket                  = aws_s3_bucket.mqtt_blocklist.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- S3 Logs Bucket (INFRA-10) ---

resource "aws_s3_bucket" "mqtt_logs" {
  bucket = "mqtt-logs-${var.region.label}-${var.site.label}-${var.site.random_suffix}"
  tags = {
    Name    = "mqtt-logs"
    Service = "run-mqtt"
    Region  = var.region.label
    Site    = var.site.label
  }
}

resource "aws_s3_bucket_public_access_block" "mqtt_logs" {
  bucket                  = aws_s3_bucket.mqtt_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "mqtt_logs" {
  bucket = aws_s3_bucket.mqtt_logs.id
  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    expiration {
      days = 30
    }
  }
}

# --- NLB DNS (INFRA-04) ---

module "nlb_dns" {
  source = "../../../../../modules/nlb-dns/v1.0.0"

  zone_id      = var.mqtt_zone_id
  domain_name  = "mqtt.${var.dns_zonename}"
  nlb_dns_name = var.nlb_dns_name
  nlb_zone_id  = var.nlb_zone_id
  region       = var.region

  providers = {
    aws.global-application = aws.global-application
  }
}
