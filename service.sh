#!/bin/bash

docker-compose --project-directory . -f apps/auth/docker-compose.yaml -f apps/run.human/docker-compose.yaml up
