locals {
  versions = {
    mosquitto  = trimspace(file("VERSION.mosquitto"))
    meshtk     = trimspace(file("VERSION.meshtk"))
    nginx      = trimspace(file("VERSION.nginx"))
    guardrails = trimspace(file("VERSION.guardrails"))
  }

  # ECR repositories for the MQTT service
  ecr_repositories = [
    {
      name                 = "run-mqtt-mosquitto"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-mqtt-nginx"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-mqtt-meshtk"
      regions              = ["us-east-1", "ca-central-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = {
        max_image_count = 10
        expire_days     = 30
      }
    },
    {
      name                 = "run-mqtt-guardrails"
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
      # Container 1: run-mqtt-mosquitto (64 CPU / 128 MB, essential)
      # Internal MQTT broker on port 1884 — all external traffic goes through meshtk proxy
      {
        name               = "run-mqtt-mosquitto"
        image              = "run-mqtt-mosquitto:${local.versions.mosquitto}"
        cpu                = 64
        memory             = 128
        memory_reservation = 64
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

      # Container 2: run-mqtt-meshtk (96 CPU / 192 MB, essential)
      # TCP proxy — intercepts MQTT CONNECT, validates credentials, pipes to mosquitto
      # Gets more resources as the primary traffic handler
      {
        name               = "run-mqtt-meshtk"
        image              = "run-mqtt-meshtk:${local.versions.meshtk}"
        cpu                = 96
        memory             = 192
        memory_reservation = 96
        essential          = true
        command            = ["meshtk", "server", "proxy", "-v", "debug"]

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
            container_name = "run-mqtt-mosquitto"
            condition      = "HEALTHY"
          }
        ]
      },

      # Container 3: run-mqtt-nginx (64 CPU / 128 MB, essential)
      # Serves meshmap HTML + meshobserv writes nodes.json via supervisord
      # nginx listens on port 80 (NLB terminates TLS at 443)
      {
        name               = "run-mqtt-nginx"
        image              = "run-mqtt-nginx:${local.versions.nginx}"
        cpu                = 64
        memory             = 128
        memory_reservation = 64
        essential          = true

        readonly_root_filesystem = false

        environment = [
          {
            # meshobserv connects DIRECTLY to the internal mosquitto broker (1884),
            # NOT the internet-facing meshtk proxy (1883). This keeps the meshobserv
            # service credential unusable from outside the task and avoids adding it
            # to the proxy's passthrough allowlist.
            name  = "MESHTK_MQTT_BROKER_URI"
            value = "tcp://localhost:1884"
          },
          {
            # NOTE: no underscore between NODEDB and PATH. meshtk binds env via
            # viper (SetEnvKeyReplacer(".","_") + AutomaticEnv), so the config key
            # `nodedbpath` maps to MESHTK_NODEDBPATH. MESHTK_NODEDB_PATH silently
            # does NOT bind, leaving meshobserv on dc34.yaml's ./nodes.dc34.json
            # (written to /nodes.dc34.json under cwd=/) so nginx 404s on nodes.json.
            name  = "MESHTK_NODEDBPATH"
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
            container_name = "run-mqtt-meshtk"
            condition      = "HEALTHY"
          }
        ]
      },

      # Container 4: run-mqtt-ghosts (128 CPU / 256 MB, NOT essential)
      # Reuses run-mqtt-meshtk image with command override for fleet simulation
      # Task continues running even if ghosts fails. Sized up from 32/64: the
      # fleet runs ~34 MQTT clients and the chatbot ghosts stay subscribed to
      # receive DMs, which the original 0.03 vCPU / 64 MB could not service.
      # `-v debug` tees the file-only logrus output to stdout/CloudWatch so the
      # ghost receive→decrypt→reply chain is observable.
      {
        name               = "run-mqtt-ghosts"
        image              = "run-mqtt-meshtk:${local.versions.meshtk}"
        cpu                = 128
        memory             = 256
        memory_reservation = 128
        essential          = false
        command            = ["meshtk", "fleet", "simulate", "-v", "debug"]

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
          },
          {
            name  = "MESHTK_GUARDRAIL_URL"
            value = "http://127.0.0.1:8000"
          },
          {
            name  = "MESHTK_GUARDRAIL_FAILMODE"
            value = "open"
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
          },
          {
            name      = "MESHTK_GHOST_KEY_SECRET"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/ghost-key-secret"
          },
          {
            name      = "MESHTK_FLAG_CHALLENGES"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/flag-challenges"
          },
          {
            name      = "MESHTK_ANTHROPIC_KEY"
            valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/mqtt/anthropic-key"
          }
        ]

        port_mappings = []

        log_stream_prefix = "ghosts"

        depends_on = [
          {
            container_name = "run-mqtt-meshtk"
            condition      = "START"
          },
          {
            container_name = "run-mqtt-guardrails"
            condition      = "HEALTHY"
          }
        ]
      },

      # Container 5: run-mqtt-guardrails (OSS Guardrails-AI sidecar, NOT essential)
      # Two-sided input/output moderation for the ghost chatbots. CPU-only; the
      # ghosts call it on 127.0.0.1:8000. Task continues if it fails; meshtk's
      # MESHTK_GUARDRAIL_FAILMODE=open degrades to un-guarded rather than blocking.
      {
        name               = "run-mqtt-guardrails"
        image              = "run-mqtt-guardrails:${local.versions.guardrails}"
        cpu                = 512
        memory             = 1024
        memory_reservation = 512
        essential          = false

        readonly_root_filesystem = false

        environment = [
          {
            name  = "HF_HOME"
            value = "/app/.cache/huggingface"
          }
        ]

        port_mappings = []

        health_check = {
          command      = ["CMD-SHELL", "curl -f http://localhost:8000/healthz || exit 1"]
          interval     = 15
          timeout      = 3
          retries      = 5
          start_period = 90
        }

        log_stream_prefix = "guardrails"

        depends_on = []
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

    # MQTT uses NLB (not ALB) for device traffic. Service discovery is enabled
    # for the nginx container so internal services (run-gpx ghost/rabbit proxies)
    # can privately fetch nodes.json at run-mqtt.app-{region}-{site}.local/nodes.json
    # without exposing the raw node DB publicly.
    service_discovery = {
      name           = "run-mqtt"
      container_name = "run-mqtt-nginx"
    }

    load_balancers = [
      # Port 1883: TCP MQTT -> meshtk:1883 (PP2 disabled — meshtk has no proxy protocol support)
      {
        type                  = "nlb"
        container_name        = "run-mqtt-meshtk"
        container_port        = 1883
        target_group_protocol = "TCP"
        proxy_protocol_v2     = false
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
      # Port 8883: TLS MQTT -> meshtk:1883 (PP2 disabled — meshtk has no proxy protocol support)
      # target_group_port = 8883 avoids target group name collision with port 1883 listener
      {
        type                  = "nlb"
        container_name        = "run-mqtt-meshtk"
        container_port        = 1883
        target_group_port     = 8883
        target_group_protocol = "TCP"
        proxy_protocol_v2     = false
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
      # Port 4433: TLS MQTT -> meshtk:1883 (Meshtastic firmware default TLS port)
      # Same as 8883 but on port 4433 for devices using Meshtastic default settings
      {
        type                  = "nlb"
        container_name        = "run-mqtt-meshtk"
        container_port        = 1883
        target_group_port     = 4433
        target_group_protocol = "TCP"
        proxy_protocol_v2     = false
        health_check_protocol = "TCP"

        health_check = {
          healthy_threshold   = 2
          unhealthy_threshold = 2
          interval            = 30
        }

        listener = {
          port            = 4433
          protocol        = "TLS"
          certificate_arn = "" # Wired via terragrunt dependency in Phase 15
        }
      },
      # Port 443: TLS HTTPS -> nginx:80 (NLB terminates TLS, nginx serves plain HTTP)
      {
        type                  = "nlb"
        container_name        = "run-mqtt-nginx"
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
      #   container_name        = "run-mqtt-mosquitto"
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
