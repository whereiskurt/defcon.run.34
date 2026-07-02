locals {
  ecr_repositories = [
    {
      name                 = "run-bib-nginx"
      regions              = ["us-east-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-bib-app"
      regions              = ["us-east-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
  ]

  # task = {}    -- populated in Plan 20-02
  # service = {} -- populated in Plan 20-02
}
