locals {
  # Derive everything from the folder name (e.g., "ap-southeast-1")
  full_region = basename(get_terragrunt_dir())
  parts       = split("-", local.full_region)

  geo = local.parts[0]   # "ap", "us", "ca", "eu", etc.
  dir = local.parts[1]   # "east", "southeast", "central", etc.
  num = local.parts[2]   # "1", "2", etc.

  # Standard AWS region direction abbreviations
  dir_abbrev = {
    east      = "e"
    west      = "w"
    central   = "c"
    south     = "s"
    north     = "n"
    southeast = "se"
    northeast = "ne"
    northwest = "nw"
    southwest = "sw"
  }

  region = {
    label = "${local.geo}${local.dir_abbrev[local.dir]}${local.num}"
    full  = local.full_region
  }
}
