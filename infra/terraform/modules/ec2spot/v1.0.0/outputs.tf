output "ec2spot_instances" {
  description = "Map of EC2 spot instance details"
  value = {
    for k, v in aws_spot_instance_request.ec2spot :
    k => {
      instance_id        = v.spot_instance_id
      public_ip          = v.public_ip
      private_ip         = v.private_ip
      availability_zone  = v.availability_zone
      instance_type      = v.instance_type
      key_name           = v.key_name
      dns_name           = try(aws_route53_record.ec2spot[k].fqdn, "")
    }
  }
}

output "ec2spot_security_group_id" {
  description = "Security group ID for EC2 spot instances"
  value       = try(aws_security_group.ec2spot[0].id, "")
}

output "ec2spot_key_files" {
  description = "Map of EC2 spot key file paths"
  value = {
    for k, v in local.ec2spot_map :
    k => v.ec2key_filename
  }
  sensitive = true
}
