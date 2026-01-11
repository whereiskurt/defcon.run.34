#!/bin/sh

# Configure mc client to connect to local MinIO
mc alias set local http://minio:9000 minioadmin minioadmin

echo "Waiting for MinIO to be ready..."
until mc admin info local; do
    sleep 1
done
echo "MinIO is ready!"

###############################################################################
# Create buckets for local development
###############################################################################

# Create run-gpx-uploads bucket for GPX Studio file storage
mc mb local/run-gpx-uploads --ignore-existing
echo "Created 'run-gpx-uploads' bucket"

# Set bucket policy to allow authenticated access
# For local dev, we'll make it accessible
mc anonymous set download local/run-gpx-uploads

echo "All buckets created successfully!"
mc ls local/
