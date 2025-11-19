# NAT Gateway needs an EIP
resource "aws_eip" "nat" {
  count  = var.nat_gateway.enabled ? 1 : 0
  domain = "vpc"

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-nat-eip"
    }
  )
}

# NAT Gateway
resource "aws_nat_gateway" "nat" {
  count         = var.nat_gateway.enabled ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = element(aws_subnet.public_subnet.*.id, 0) # Uses the first public subnet

  tags = merge(
    var.vpc.tags,
    {
      Name = "${var.region.label}.${var.dns.zonename}-nat"
    }
  )

  depends_on = [aws_internet_gateway.ig]
}

# Routes for NAT Gateway in private route table
resource "aws_route" "private_nat_gateway" {
  count                  = var.nat_gateway.enabled ? 1 : 0
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat[0].id
}
