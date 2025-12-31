export default ({ env }) => {
  const s3AccessKey = env('S3_MEDIA_ACCESS_KEY');
  const s3Bucket = env('S3_MEDIA_BUCKET');

  // Only configure S3 if credentials are provided
  const uploadConfig = s3AccessKey && s3Bucket
    ? {
        config: {
          provider: '@strapi/provider-upload-aws-s3',
          providerOptions: {
            accessKeyId: s3AccessKey,
            secretAccessKey: env('S3_MEDIA_SECRET_KEY'),
            region: env('S3_MEDIA_REGION', 'us-east-1'),
            params: {
              Bucket: s3Bucket,
              ACL: null, // Bucket policy handles access
            },
          },
          actionOptions: {
            upload: {},
            uploadStream: {},
            delete: {},
          },
        },
      }
    : {}; // Use default local provider

  // Configure SES using AWS SDK default credential chain (IAM role on Fargate, local profile)
  const emailConfig = {
    config: {
      provider: '@strapi/provider-email-amazon-ses',
      providerOptions: {
        region: env('AWS_REGION', 'us-east-1'),
      },
      settings: {
        defaultFrom: env('SES_FROM_ADDRESS', 'cms@defcon.run'),
        defaultReplyTo: env('SES_REPLYTO_ADDRESS', 'cms@defcon.run'),
      },
    },
  };

  // Users & Permissions plugin - requires jwtSecret for authentication tokens
  const usersPermissionsConfig = {
    config: {
      jwtSecret: env('JWT_SECRET'),
    },
  };

  return {
    upload: uploadConfig,
    email: emailConfig,
    'users-permissions': usersPermissionsConfig,
  };
};
