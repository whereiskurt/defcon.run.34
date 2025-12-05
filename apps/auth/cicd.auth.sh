#!/bin/bash

time cd /Users/khundeck/working/defcon.run.34/apps/auth \
    && ./release.nginx.sh && ./deploy.nginx.sh && cp nginx/VERSION ../../infra/terraform/live/site/services/auth/VERSION.nginx && date \
    && ./release.webapp.sh && ./deploy.webapp.sh && cp webdapp/VERSION ../../infra/terraform/live/site/services/auth/VERSION.app && date \
    && cd /Users/khundeck/working/defcon.run.34/infra/terraform/live/site \
    && terragrunt run-all apply --terragrunt-non-interactive -auto-approve \
    && cd - \
    && date
