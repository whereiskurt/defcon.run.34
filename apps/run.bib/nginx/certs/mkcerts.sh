#!/bin/bash

# Generate private key, self-signed certificate, and CSR for run.bib nginx sidecar.
# These certs terminate TLS between the ALB and the nginx container inside the
# ECS task — they are NOT the user-facing certificate. That's ACM in front.
openssl req -new -newkey rsa:2048 -nodes -keyout nginx-selfsigned.key -out nginx-selfsigned.csr -subj "/C=US/ST=Nevada/L=LasVegas/O=defcon.run/OU=Engineering/CN=bib.defcon.run"

# Create self-signed certificate from the private key
openssl x509 -req -days 365 -in nginx-selfsigned.csr -signkey nginx-selfsigned.key -out nginx-selfsigned.crt
