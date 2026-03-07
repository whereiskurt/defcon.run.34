locals {
  # ECR repositories for the MQTT service
  ecr_repositories = [
    {
      name                 = "mqtt-mosquitto"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "mqtt-nginx"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "mqtt-meshtk"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    }
  ]

  # ECS Task definition for the MQTT service
  # Containers will be populated in Phase 15
  task = {
    name         = "run-mqtt"
    regions      = ["us-east-1", "ca-central-1"]
    cluster_name = "app"
    task_cpu     = 1024
    task_memory  = 2048
    containers   = [] # Populated in Phase 15
  }

  # ECS Service definition for the MQTT service
  service = {
    name          = "run-mqtt"
    regions       = ["us-east-1", "ca-central-1"]
    cluster_name  = "app"
    task_family   = "run-mqtt" # Must match task definition family from task above
    desired_count = 1

    load_balancers = [
      # Port 1883: TCP MQTT -> meshtk:1883 (Proxy Protocol v2 enabled)
      {
        type                  = "nlb"
        container_name        = "mqtt-meshtk"
        container_port        = 1883
        target_group_protocol = "TCP"
        proxy_protocol_v2     = true
        health_check_protocol = "TCP"

        health_check = {
          healthy_threshold   = 2
          unhealthy_threshold = 2
          interval            = 30
        }

        listener = {
          port     = 1883
          protocol = "TCP"
        }
      },
      # Port 8883: TLS MQTT -> meshtk:1883 (PP2 enabled, NLB terminates TLS)
      # target_group_port = 8883 avoids target group name collision with port 1883 listener
      {
        type                  = "nlb"
        container_name        = "mqtt-meshtk"
        container_port        = 1883
        target_group_port     = 8883
        target_group_protocol = "TCP"
        proxy_protocol_v2     = true
        health_check_protocol = "TCP"

        health_check = {
          healthy_threshold   = 2
          unhealthy_threshold = 2
          interval            = 30
        }

        listener = {
          port            = 8883
          protocol        = "TLS"
          certificate_arn = "" # Wired via terragrunt dependency in Phase 15
        }
      },
      # Port 443: TLS HTTPS -> nginx:443 (NLB terminates TLS)
      {
        type                  = "nlb"
        container_name        = "mqtt-nginx"
        container_port        = 443
        target_group_protocol = "TCP"
        proxy_protocol_v2     = false
        health_check_protocol = "TCP"

        health_check = {
          healthy_threshold   = 2
          unhealthy_threshold = 2
          interval            = 30
        }

        listener = {
          port            = 443
          protocol        = "TLS"
          certificate_arn = "" # Wired via terragrunt dependency in Phase 15
        }
      },
      # Port 8443: TLS WebSocket -> mosquitto:9001 (NLB terminates TLS)
      {
        type                  = "nlb"
        container_name        = "mqtt-mosquitto"
        container_port        = 9001
        target_group_protocol = "TCP"
        proxy_protocol_v2     = false
        health_check_protocol = "TCP"

        health_check = {
          healthy_threshold   = 2
          unhealthy_threshold = 2
          interval            = 30
        }

        listener = {
          port            = 8443
          protocol        = "TLS"
          certificate_arn = "" # Wired via terragrunt dependency in Phase 15
        }
      }
    ]

    autoscaling = {
      enabled      = false
      min_capacity = 1
      max_capacity = 2

      cpu_target = {
        scale_out_threshold = 75
        scale_in_threshold  = 25
        evaluation_periods  = 2
        period              = 60
        cooldown            = 120
      }
    }
  }
}
