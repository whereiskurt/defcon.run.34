# Map of all ECR repositories in this region by repository name
output "repositories" {
  description = "Map of ECR repositories by name"
  value = {
    for name, repo in local.repositories_map :
    name => {
      repository_name      = aws_ecr_repository.repository[name].name
      repository_url       = aws_ecr_repository.repository[name].repository_url
      registry_id          = aws_ecr_repository.repository[name].registry_id
      arn                  = aws_ecr_repository.repository[name].arn
      image_tag_mutability = repo.image_tag_mutability
      scan_on_push         = repo.scan_on_push
      encryption_type      = repo.encryption_type
      region               = var.region.full
      region_label         = var.region.label
    }
  }
}

# Simplified output: repository URLs by name for easy reference in task definitions
output "repository_urls" {
  description = "Map of repository URLs by repository name"
  value = {
    for name, _ in local.repositories_map :
    name => aws_ecr_repository.repository[name].repository_url
  }
}

# Repository names
output "repository_names" {
  description = "List of repository names in this region"
  value       = [for name, _ in local.repositories_map : aws_ecr_repository.repository[name].name]
}

# Full repository URLs with tags for easy copy-paste into task definitions
output "repository_urls_with_latest" {
  description = "Map of repository URLs with :latest tag"
  value = {
    for name, _ in local.repositories_map :
    name => "${aws_ecr_repository.repository[name].repository_url}:latest"
  }
}
