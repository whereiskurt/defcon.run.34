# VPC Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.vpc.id
}

output "vpc_cidr_block" {
  description = "CIDR block of the VPC"
  value       = aws_vpc.vpc.cidr_block
}

output "availability_zones" {
  description = "List of availability zones used by the VPC"
  value       = local.availability_zones
}

# Subnet Outputs
output "public_subnets" {
  description = "List of IDs of public subnets"
  value       = aws_subnet.public_subnet[*].id
}

output "private_subnets" {
  description = "List of IDs of private subnets"
  value       = aws_subnet.private_subnet[*].id
}

# Route Table Outputs
output "public_route_table_id" {
  description = "ID of the public route table"
  value       = aws_route_table.public.id
}

output "private_route_table_id" {
  description = "ID of the private route table"
  value       = aws_route_table.private.id
}

# Internet Gateway Output
output "internet_gateway_id" {
  description = "ID of the Internet Gateway"
  value       = aws_internet_gateway.ig.id
}

# NAT Gateway Outputs
output "nat_gateway_id" {
  description = "ID of the NAT Gateway (if enabled)"
  value       = var.nat_gateway.enabled ? aws_nat_gateway.nat[0].id : null
}

output "nat_eip_public_ip" {
  description = "Public IP of the NAT Gateway EIP (if enabled)"
  value       = var.nat_gateway.enabled ? aws_eip.nat[0].public_ip : null
}

# Security Group Outputs
output "security_groups" {
  description = "Map of security group IDs by name"
  value = {
    sshhttps  = aws_security_group.sshhttps.id
    http_only = aws_security_group.http_only.id
    postgres  = aws_security_group.postgres.id
    etherpad  = aws_security_group.etherpad.id
    nlb       = aws_security_group.nlb.id
  }
}

# Default security group list for ECS services
output "security_group_ids" {
  description = "List of default security group IDs for ECS services"
  value = concat(
    [
      aws_security_group.sshhttps.id,
      aws_security_group.http_only.id
    ],
    var.nlb.enabled ? [aws_security_group.nlb.id] : []
  )
}

# Subnet aliases for compatibility
output "private_subnet_ids" {
  description = "Alias for private_subnets (for compatibility)"
  value       = aws_subnet.private_subnet[*].id
}

output "public_subnet_ids" {
  description = "Alias for public_subnets (for compatibility)"
  value       = aws_subnet.public_subnet[*].id
}

# Load Balancer Outputs
output "alb_arn" {
  description = "ARN of the Application Load Balancer (if enabled)"
  value       = var.alb.enabled ? aws_lb.lb_public[0].arn : null
}

output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer (if enabled)"
  value       = var.alb.enabled ? aws_lb.lb_public[0].dns_name : null
}

output "alb_zone_id" {
  description = "Zone ID of the Application Load Balancer (if enabled)"
  value       = var.alb.enabled ? aws_lb.lb_public[0].zone_id : null
}

output "alb_listener_arn" {
  description = "ARN of the HTTPS listener (if enabled and certificate available in cert_map)"
  value       = length(aws_lb_listener.https) > 0 ? aws_lb_listener.https[0].arn : null
}

output "nlb_arn" {
  description = "ARN of the Network Load Balancer (if enabled)"
  value       = var.nlb.enabled ? aws_lb.nlb_public[0].arn : null
}

output "nlb_dns_name" {
  description = "DNS name of the Network Load Balancer (if enabled)"
  value       = var.nlb.enabled ? aws_lb.nlb_public[0].dns_name : null
}

output "nlb_zone_id" {
  description = "Zone ID of the Network Load Balancer (if enabled)"
  value       = var.nlb.enabled ? aws_lb.nlb_public[0].zone_id : null
}

# VPC Flow Logs Outputs
output "vpc_flow_logs_bucket_name" {
  description = "Name of the S3 bucket for VPC flow logs (if enabled)"
  value       = var.vpc_flow_logs.enabled ? aws_s3_bucket.vpc_flow_logs[0].bucket : null
}

output "vpc_flow_logs_bucket_arn" {
  description = "ARN of the S3 bucket for VPC flow logs (if enabled)"
  value       = var.vpc_flow_logs.enabled ? aws_s3_bucket.vpc_flow_logs[0].arn : null
}

# ALB Logs Outputs
output "alb_logs_bucket_name" {
  description = "Name of the S3 bucket for ALB logs (if enabled)"
  value       = var.alb.enabled ? aws_s3_bucket.alb_log_bucket[0].bucket : null
}

output "alb_logs_bucket_arn" {
  description = "ARN of the S3 bucket for ALB logs (if enabled)"
  value       = var.alb.enabled ? aws_s3_bucket.alb_log_bucket[0].arn : null
}

# NLB Logs Outputs
output "nlb_logs_bucket_name" {
  description = "Name of the S3 bucket for NLB logs (if enabled)"
  value       = var.nlb.enabled ? aws_s3_bucket.nlb_logs[0].bucket : null
}

output "nlb_logs_bucket_arn" {
  description = "ARN of the S3 bucket for NLB logs (if enabled)"
  value       = var.nlb.enabled ? aws_s3_bucket.nlb_logs[0].arn : null
}

# VPC Endpoints Outputs
output "vpc_endpoint_ecr_api_id" {
  description = "ID of the ECR API VPC endpoint (if enabled)"
  value       = var.vpc_endpoints.enabled ? aws_vpc_endpoint.ecr_api[0].id : null
}

output "vpc_endpoint_ecr_dkr_id" {
  description = "ID of the ECR DKR VPC endpoint (if enabled)"
  value       = var.vpc_endpoints.enabled ? aws_vpc_endpoint.ecr_dkr[0].id : null
}

output "vpc_endpoint_s3_id" {
  description = "ID of the S3 VPC gateway endpoint (if enabled)"
  value       = var.vpc_endpoints.enabled ? aws_vpc_endpoint.s3_gateway_endpoint[0].id : null
}

output "vpc_endpoint_logs_id" {
  description = "ID of the CloudWatch Logs VPC endpoint (if enabled)"
  value       = var.vpc_endpoints.enabled ? aws_vpc_endpoint.logs[0].id : null
}

output "vpc_endpoint_ssm_id" {
  description = "ID of the SSM VPC endpoint (if enabled)"
  value       = var.vpc_endpoints.enabled ? aws_vpc_endpoint.ssm[0].id : null
}
