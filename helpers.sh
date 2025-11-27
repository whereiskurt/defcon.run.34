#!/bin/bash

# Terragrunt helper functions
# Source this file to use: source tg-helpers.sh

# Terragrunt plan
tfp() {
    time terragrunt plan \
        --terragrunt-non-interactive \
        --terragrunt-include-external-dependencies \
        --terragrunt-log-level debug \
        >> plan.output.txt 2>&1
}

# Terragrunt apply
tfa() {
    time terragrunt apply \
        --terragrunt-non-interactive \
        --terragrunt-include-external-dependencies \
        --terragrunt-log-level debug \
        -auto-approve \
        >> apply.output.txt 2>&1
}

# Terragrunt destroy
tfd() {
    time terragrunt destroy \
        --terragrunt-non-interactive \
        --terragrunt-include-external-dependencies \
        --terragrunt-log-level debug \
        -auto-approve \
        >> destroy.output.txt 2>&1
}

# Terragrunt plan (no redirect - show output)
tfp-show() {
    time terragrunt plan \
        --terragrunt-non-interactive \
        --terragrunt-include-external-dependencies \
        --terragrunt-log-level debug
}

# Terragrunt apply (no redirect - show output)
tfa-show() {
    time terragrunt apply \
        --terragrunt-non-interactive \
        --terragrunt-include-external-dependencies \
        --terragrunt-log-level debug \
        -auto-approve
}

# Terragrunt destroy (no redirect - show output)
tfd-show() {
    time terragrunt destroy \
        --terragrunt-non-interactive \
        --terragrunt-include-external-dependencies \
        --terragrunt-log-level debug \
        -auto-approve
}
