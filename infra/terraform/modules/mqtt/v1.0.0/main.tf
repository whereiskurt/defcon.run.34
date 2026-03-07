# MQTT regional resources: S3 buckets, NLB DNS records, and infra SSM parameters

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

# --- SSM Parameters for infra-created values (consumed by ECS task secrets) ---

resource "aws_ssm_parameter" "logs_bucket" {
  name  = "/${var.site.label}/infra/${var.region.label}/mqtt/logs_bucket"
  type  = "String"
  value = aws_s3_bucket.mqtt_logs.bucket
  tags = {
    Service = "run-mqtt"
    Region  = var.region.label
  }
}

resource "aws_ssm_parameter" "blocklist_bucket" {
  name  = "/${var.site.label}/infra/${var.region.label}/mqtt/blocklist_bucket"
  type  = "String"
  value = aws_s3_bucket.mqtt_blocklist.bucket
  tags = {
    Service = "run-mqtt"
    Region  = var.region.label
  }
}

# --- NLB DNS (INFRA-04) ---
# Inline Route53 latency-based alias record for mqtt.defcon.run -> NLB
# (Inlined from nlb-dns module to avoid cross-module relative path issues with terragrunt cache)

resource "aws_route53_record" "nlb_alias" {
  provider = aws.global-application

  zone_id = var.mqtt_zone_id
  name    = "mqtt.${var.dns_zonename}"
  type    = "A"

  set_identifier = var.region.label

  alias {
    name                   = var.nlb_dns_name
    zone_id                = var.nlb_zone_id
    evaluate_target_health = true
  }

  latency_routing_policy {
    region = var.region.full
  }
}
