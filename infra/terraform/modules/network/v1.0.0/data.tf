# Fetch available availability zones in the region
data "aws_availability_zones" "available" {
  state = "available"
}

# Calculate the availability zones to use based on the count
locals {
  availability_zones = slice(
    data.aws_availability_zones.available.names,
    0,
    var.vpc.availability_zone_count
  )
}
