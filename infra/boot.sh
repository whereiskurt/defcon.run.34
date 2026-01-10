#!/bin/bash

cd terraform/live/site

## Crawl through all subfolders and stand-up the infrastructure
terragrunt apply --all \
    --non-interactive \
    -- -auto-approve

cd -
