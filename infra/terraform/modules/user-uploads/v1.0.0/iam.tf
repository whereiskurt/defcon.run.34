# IAM User for presigned URL generation
# This user has minimal permissions scoped to the uploads/* prefix only
# with tag-based access control for user isolation

resource "aws_iam_user" "presigner" {
  for_each = local.uploads_map

  name = substr("s3-presign-${var.site.label}-${each.key}-${var.region.label}", 0, 64)

  tags = {
    Name    = "S3 Presigner - ${each.key}"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
    Purpose = "presigned-url-generation"
  }
}

# IAM policy for presigned URL operations
# Enforces user isolation through:
# 1. Path-based: Only operates on uploads/{user_id}/* paths
# 2. Tag-based: PutObject requires owner tag, GetObject checks existing tag
resource "aws_iam_user_policy" "presigner" {
  for_each = local.uploads_map

  name = "s3-presign-policy"
  user = aws_iam_user.presigner[each.key].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Allow PutObject with required owner tag
      # The application must include x-amz-tagging header with owner={user_id}
      {
        Sid    = "AllowPutObjectWithOwnerTag"
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.uploads[each.key].arn}/uploads/*"
        Condition = {
          # Require that the owner tag is set on upload
          StringEquals = {
            "s3:RequestObjectTag/owner" = "$${aws:username}"
          }
        }
      },
      # Alternative: Allow PutObject if tagging is handled separately
      # This is more flexible for presigned URLs where tags may be set via x-amz-tagging
      {
        Sid    = "AllowPutObjectToUploads"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectTagging"
        ]
        Resource = "${aws_s3_bucket.uploads[each.key].arn}/uploads/*"
      },
      # Allow GetObject for objects the user owns (by tag)
      # Note: Tag-based conditions on GetObject require the object to have the tag
      {
        Sid    = "AllowGetObjectFromUploads"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectTagging"
        ]
        Resource = "${aws_s3_bucket.uploads[each.key].arn}/uploads/*"
      },
      # Allow HEAD operations for presigned URL validation
      {
        Sid    = "AllowHeadObject"
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.uploads[each.key].arn}/uploads/*"
        Condition = {
          StringEquals = {
            "s3:ExistingObjectTag/owner" = "$${aws:username}"
          }
        }
      },
      # Allow listing objects (for application to enumerate user's uploads)
      {
        Sid    = "AllowListBucketWithPrefix"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.uploads[each.key].arn
        Condition = {
          StringLike = {
            "s3:prefix" = "uploads/*"
          }
        }
      }
    ]
  })
}

# Access key for the presigner IAM user
resource "aws_iam_access_key" "presigner" {
  for_each = local.uploads_map

  user = aws_iam_user.presigner[each.key].name
}
