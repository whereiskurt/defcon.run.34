locals {
  versions = {
    mosquitto = trimspace(file("VERSION.mosquitto"))
    meshtk    = trimspace(file("VERSION.meshtk"))
    nginx     = trimspace(file("VERSION.nginx"))
  }

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
  # 4 containers: mosquitto -> meshtk (HEALTHY) -> nginx (HEALTHY) + ghosts (START)
  task = {
    name         = "run-mqtt"
    regions      = ["us-east-1", "ca-central-1"]
    cluster_name = "app"
    task_cpu     = 1024
    task_memory  = 2048

    containers = [
      # Container 1: mqtt-mosquitto (256 CPU / 384 MB, essential)
      # Internal MQTT broker on port 1884 — all external traffic goes through meshtk proxy
      {
        name               = "mqtt-mosquitto"
        image              = "mqtt-mosquitto:${local.versions.mosquitto}"
        cpu                = 256
        memory             = 384
        memory_reservation = 256
        essential          = true

        readonly_root_filesystem = false

        environment = []

        secrets = [
          {
            name      = "MQTT_MESHTK_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/meshtk-proxy-password"
          },
          {
            name      = "MQTT_MESHOBSERV_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/meshobserv-password"
          },
          {
            name      = "MQTT_GHOSTS_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghosts-password"
          },
          {
            name      = "MQTT_MAX_CONNECTIONS"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/max-connections"
          }
        ]

        port_mappings = [
          {
            container_port = 1884
            host_port      = 1884
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "nc -z localhost 1884 || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 30
        }

        log_stream_prefix = "mosquitto"

        depends_on = []
      },

      # Container 2: mqtt-meshtk (384 CPU / 768 MB, essential)
      # TCP proxy — intercepts MQTT CONNECT, validates credentials, pipes to mosquitto
      # Gets more resources as the primary traffic handler
      {
        name               = "mqtt-meshtk"
        image              = "mqtt-meshtk:${local.versions.meshtk}"
        cpu                = 384
        memory             = 768
        memory_reservation = 512
        essential          = true
        command            = ["meshtk", "server", "proxy"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "MESHTK_MQTT_BROKER_URI"
            value = "tcp://localhost:1884"
          },
          {
            name  = "MESHTK_LISTEN_ADDR"
            value = "0.0.0.0:1883"
          },
          {
            name  = "MESHTK_MQTT_USERNAME"
            value = "meshtk-proxy"
          },
          {
            name  = "MESHTK_NODEINFO_TOPIC"
            value = "msh/US/2/e/dc.run"
          },
          {
            name  = "MESHTK_NODEINFO_CHANNELSLOT"
            value = "primary"
          },
          {
            name  = "MESHTK_TEXTMESSAGE_TOPIC"
            value = "msh/US/2/e/dc.run"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          }
        ]

        secrets = [
          {
            name      = "MESHTK_MQTT_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/meshtk-proxy-password"
          },
          {
            name      = "MESHTK_S3_LOGS_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/infra/{{REGION_LABEL}}/mqtt/logs_bucket"
          },
          {
            name      = "MESHTK_S3_BLOCKLIST_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/infra/{{REGION_LABEL}}/mqtt/blocklist_bucket"
          },
          {
            name      = "MESHTK_LOG_INTERVAL"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/s3-log-interval"
          }
        ]

        port_mappings = [
          {
            container_port = 1883
            host_port      = 1883
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "nc -z localhost 1883 || exit 1"]
          interval     = 30
          timeout      = 3
          retries      = 3
          start_period = 10
        }

        log_stream_prefix = "meshtk"

        depends_on = [
          {
            container_name = "mqtt-mosquitto"
            condition     = "HEALTHY"
          }
        ]
      },

      # Container 3: mqtt-nginx (256 CPU / 512 MB, essential)
      # Serves meshmap HTML + meshobserv writes nodes.json via supervisord
      # nginx listens on port 80 (NLB terminates TLS at 443)
      {
        name               = "mqtt-nginx"
        image              = "mqtt-nginx:${local.versions.nginx}"
        cpu                = 256
        memory             = 512
        memory_reservation = 384
        essential          = true

        readonly_root_filesystem = false

        environment = [
          {
            name  = "MESHTK_MQTT_BROKER_URI"
            value = "tcp://localhost:1883"
          },
          {
            name  = "MESHTK_NODEDB_PATH"
            value = "/var/www/html/nodes.json"
          },
          {
            name  = "MESHTK_MQTT_USERNAME"
            value = "meshobserv"
          },
          {
            name  = "MESHTK_NODEINFO_TOPIC"
            value = "msh/US/2/e/dc.run"
          },
          {
            name  = "MESHTK_NODEINFO_CHANNELSLOT"
            value = "primary"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          }
        ]

        secrets = [
          {
            name      = "MESHTK_MQTT_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/meshobserv-password"
          },
          {
            name      = "MESHTK_CHANNEL_PSK"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/channel-psk"
          },
          {
            name      = "MESHTK_S3_SNAPSHOT_BUCKET"
            valueFrom = "/{{SITE_LABEL}}/infra/{{REGION_LABEL}}/mqtt/logs_bucket"
          }
        ]

        port_mappings = [
          {
            container_port = 80
            host_port      = 80
          }
        ]

        health_check = {
          command      = ["CMD-SHELL", "curl -f http://localhost/ || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 15
        }

        log_stream_prefix = "nginx"

        depends_on = [
          {
            container_name = "mqtt-meshtk"
            condition      = "HEALTHY"
          }
        ]
      },

      # Container 4: mqtt-ghosts (128 CPU / 384 MB, NOT essential)
      # Reuses mqtt-meshtk image with command override for fleet simulation
      # Task continues running even if ghosts fails
      {
        name               = "mqtt-ghosts"
        image              = "mqtt-meshtk:${local.versions.meshtk}"
        cpu                = 128
        memory             = 384
        memory_reservation = 256
        essential          = false
        command            = ["meshtk", "fleet", "simulate"]

        readonly_root_filesystem = false

        environment = [
          {
            name  = "MESHTK_MQTT_BROKER_URI"
            value = "tcp://localhost:1883"
          },
          {
            name  = "MESHTK_MQTT_USERNAME"
            value = "ghosts"
          },
          {
            name  = "MESHTK_NODEINFO_TOPIC"
            value = "msh/US/2/e/dc.run"
          },
          {
            name  = "MESHTK_NODEINFO_CHANNELSLOT"
            value = "primary"
          },
          {
            name  = "MESHTK_TEXTMESSAGE_TOPIC"
            value = "msh/US/2/e/dc.run"
          },
          {
            name  = "AWS_REGION"
            value = "{{REGION}}"
          }
        ]

        secrets = [
          {
            name      = "MESHTK_MQTT_PASSWORD"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghosts-password"
          },
          {
            name      = "MESHTK_GHOST_START_DELAY"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghost-start-delay"
          }
        ]

        port_mappings = []

        log_stream_prefix = "ghosts"

        depends_on = [
          {
            container_name = "mqtt-meshtk"
            condition      = "START"
          }
        ]
      }
    ]
  }

  # ECS Service definition for the MQTT service
  service = {
    name          = "run-mqtt"
    regions       = ["us-east-1", "ca-central-1"]
    cluster_name  = "app"
    task_family   = "run-mqtt" # Must match task definition family from task above
    desired_count = 1

    # MQTT uses NLB (not ALB), no service discovery needed
    service_discovery = {
      name           = "run-mqtt"
      container_name = ""
    }

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
      # Port 443: TLS HTTPS -> nginx:80 (NLB terminates TLS, nginx serves plain HTTP)
      {
        type                  = "nlb"
        container_name        = "mqtt-nginx"
        container_port        = 80
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
      }
      # WebSocket MQTT (8443) — deferred, uncomment when enabling WebSocket support
      # {
      #   type                  = "nlb"
      #   container_name        = "mqtt-mosquitto"
      #   container_port        = 9001
      #   target_group_protocol = "TCP"
      #   proxy_protocol_v2     = false
      #   health_check_protocol = "TCP"
      #
      #   health_check = {
      #     healthy_threshold   = 2
      #     unhealthy_threshold = 2
      #     interval            = 30
      #   }
      #
      #   listener = {
      #     port            = 8443
      #     protocol        = "TLS"
      #     certificate_arn = "" # Wired via terragrunt dependency
      #   }
      # }
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
