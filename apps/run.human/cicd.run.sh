#!/bin/bash

cd /Users/khundeck/working/defcon.run.34/apps/run.human \
    && ./release.nginx.sh && ./deploy.nginx.sh && cp nginx/VERSION ../../infra/terraform/live/site/services/run-human/VERSION.nginx \
    && ./release.webapp.sh && ./deploy.webapp.sh && cp webapp/VERSION ../../infra/terraform/live/site/services/run-human/VERSION.app  \
    && cd /Users/khundeck/working/defcon.run.34/infra/terraform/live/site \
    && terragrunt run-all apply --terragrunt-non-interactive -auto-approve \
    && cd - \
    && date
