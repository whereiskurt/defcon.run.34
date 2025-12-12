#!/bin/bash

cd terraform/live/site

## Crawl through all subfolders and stand-up the infrastructure
terragrunt run-all apply \
    --terragrunt-non-interactive \
    -auto-approve

cd -