# ECS Task Definition Examples

This file contains examples of how to configure different app types in `site.hcl` using the `ecs_tasks` parameter.

## NextJS App (nginx + app)

```hcl
{
  name         = "webapp"
  regions      = ["us-east-1", "ca-central-1"]  # Deploy to multiple regions
  cluster_name = "app"
  task_cpu     = 512
  task_memory  = 1024

  containers = [
    {
      name               = "nginx"
      image              = "webapp-nginx:latest"  # Module constructs full ECR URL automatically
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["nginx", "-g", "daemon off;"]

      environment = [
        { name = "APP_URL", value = "https://run.<domain>" }
      ]

      port_mappings = [
        { container_port = 443, host_port = 443 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -k -f https://localhost/hello || exit 1"]
        interval     = 60
        timeout      = 5
        retries      = 3
        start_period = 120
      }

      log_stream_prefix = "nginx"
    },
    {
      name               = "app"
      image              = "webapp:latest"  # Module constructs full ECR URL automatically
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["npm", "run", "start"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "NEXTAUTH_URL", value = "https://run.<domain>" }
      ]

      secrets = [
        { name = "AUTH_JWT_SECRET", valueFrom = "/<domain-slug>/auth/secret" },
        { name = "AUTH_DYNAMODB_ID", valueFrom = "/<region_label>.<domain>/next-auth/access_key" }
      ]

      port_mappings = [
        { container_port = 3000, host_port = 3000 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -f -k http://localhost:3000/hello || exit 1"]
        interval     = 30
        timeout      = 5
        retries      = 3
        start_period = 120
      }

      log_stream_prefix = "app"
    }
  ]
}
```

## MQTT App (mosquitto + grpc + nginx + ghosts)

```hcl
{
  name         = "mqtt"
  regions      = ["us-east-1", "ca-central-1"]  # Deploy to multiple regions
  cluster_name = "app"
  task_cpu     = 1024
  task_memory  = 2048

  containers = [
    {
      name               = "mosquitto"
      image              = "mqtt-mosquitto:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]

      port_mappings = [
        { container_port = 1884, host_port = 1884 },
        { container_port = 9001, host_port = 9001 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "nc -z localhost 1884 || exit 1"]
        interval     = 60
        timeout      = 15
        retries      = 3
        start_period = 5
      }

      log_stream_prefix = "mosquitto"
    },
    {
      name               = "grpc"
      image              = "mqtt-grpc:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["/meshtk/meshtk", "server", "proxy", "--verbose=trace"]

      depends_on = [
        { container_name = "mosquitto", condition = "HEALTHY" }
      ]

      secrets = [
        { name = "MESHTK_SERVER_S3BUCKETNAME", valueFrom = "/<region_label>.<domain>/mqtt/s3/logging_bucket_name" },
        { name = "USER_CREATION_SEED", valueFrom = "/<domain-slug>/auth/secret" }
      ]

      port_mappings = [
        { container_port = 1883, host_port = 1883 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "nc -z localhost 1883 || exit 1"]
        interval     = 60
        timeout      = 15
        retries      = 3
        start_period = 5
      }

      log_stream_prefix = "grpc"
    },
    {
      name               = "nginx"
      image              = "mqtt-nginx:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

      depends_on = [
        { container_name = "grpc", condition = "HEALTHY" }
      ]

      environment = [
        { name = "APP_URL", value = "https://mqtt.<domain>" },
        { name = "MESHMAP_NODES_URL", value = "https://mqtt.<domain>/map/nodes.json" }
      ]

      secrets = [
        { name = "MQTT_USERNAME", valueFrom = "/<region_label>.<domain>/meshmap/mqtt_username" },
        { name = "MQTT_PASSWORD", valueFrom = "/<region_label>.<domain>/meshmap/mqtt_password" }
      ]

      port_mappings = [
        { container_port = 443, host_port = 443 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -k -f https://localhost/hello || exit 1"]
        interval     = 60
        timeout      = 5
        retries      = 3
        start_period = 5
      }

      log_stream_prefix = "nginx"
    },
    {
      name               = "ghosts"
      image              = "mqtt-ghosts:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = false
      command            = ["/meshtk/meshtk", "fleet", "simulate", "--verbose=trace"]

      depends_on = [
        { container_name = "nginx", condition = "HEALTHY" }
      ]

      secrets = [
        { name = "MESHTK_OPENAI_KEY", valueFrom = "/<domain-slug>/openai/botsecret" }
      ]

      health_check = {
        command      = ["CMD-SHELL", "exit 0"]
        interval     = 60
        timeout      = 15
        retries      = 3
        start_period = 5
      }

      log_stream_prefix = "ghosts"
    }
  ]
}
```

## Strapi App (nginx + app with database)

```hcl
{
  name         = "strapi"
  regions      = ["us-east-1", "ca-central-1"]  # Deploy to multiple regions
  cluster_name = "app"
  task_cpu     = 1024
  task_memory  = 2048

  containers = [
    {
      name               = "nginx"
      image              = "strapi-nginx:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["nginx", "-g", "daemon off;"]

      depends_on = [
        { container_name = "app", condition = "START" }
      ]

      environment = [
        { name = "APP_URL", value = "https://strapi.<domain>" }
      ]

      port_mappings = [
        { container_port = 443, host_port = 443 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -k -f https://localhost/hello || exit 1"]
        interval     = 60
        timeout      = 5
        retries      = 3
        start_period = 120
      }

      log_stream_prefix = "nginx"
    },
    {
      name               = "app"
      image              = "strapi:latest"
      cpu                = 768
      memory             = 1536
      memory_reservation = 768
      essential          = true
      command            = ["npm", "run", "start"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = "us-east-1" },
        { name = "DATABASE_POOL_MIN", value = "0" }
      ]

      secrets = [
        { name = "DATABASE_CLIENT", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/strapi/db_engine" },
        { name = "DATABASE_HOST", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/strapi/db_endpoint_writer" },
        { name = "DATABASE_PORT", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/strapi/db_port" },
        { name = "DATABASE_USERNAME", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/strapi/db_username" },
        { name = "DATABASE_PASSWORD", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/strapi/db_password" },
        { name = "DATABASE_NAME", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/strapi/db_dbname" },
        { name = "APP_KEYS", valueFrom = "/<domain-slug>/strapi/app_keys" },
        { name = "API_TOKEN_SALT", valueFrom = "/<domain-slug>/strapi/api_token_salt" },
        { name = "ADMIN_JWT_SECRET", valueFrom = "/<domain-slug>/strapi/admin_jwt_secret" },
        { name = "TRANSFER_TOKEN_SALT", valueFrom = "/<domain-slug>/strapi/transfer_token_salt" },
        { name = "JWT_SECRET", valueFrom = "/<domain-slug>/strapi/jwt_secret" }
      ]

      port_mappings = [
        { container_port = 1337, host_port = 1337 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -f http://localhost:1337/_health || exit 1"]
        interval     = 60
        timeout      = 5
        retries      = 3
        start_period = 120
      }

      log_stream_prefix = "app"
    }
  ]
}
```

## Etherpad App (nginx + app with database)

```hcl
{
  name         = "etherpad"
  regions      = ["us-east-1", "ca-central-1"]  # Deploy to multiple regions
  cluster_name = "app"
  task_cpu     = 512
  task_memory  = 1024

  containers = [
    {
      name               = "nginx"
      image              = "etherpad-nginx:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["nginx", "-g", "daemon off;"]

      depends_on = [
        { container_name = "app", condition = "START" }
      ]

      environment = [
        { name = "APP_URL", value = "https://etherpad.<domain>" }
      ]

      port_mappings = [
        { container_port = 443, host_port = 443 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -k -f https://localhost/hello || exit 1"]
        interval     = 60
        timeout      = 5
        retries      = 3
        start_period = 120
      }

      log_stream_prefix = "nginx"
    },
    {
      name               = "app"
      image              = "etherpad:latest"
      cpu                = 256
      memory             = 512
      memory_reservation = 256
      essential          = true
      command            = ["node", "src/node/server.js"]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "TRUST_PROXY", value = "true" }
      ]

      secrets = [
        { name = "DB_TYPE", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/etherpad/db_engine" },
        { name = "DB_HOST", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/etherpad/db_endpoint_writer" },
        { name = "DB_PORT", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/etherpad/db_port" },
        { name = "DB_USER", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/etherpad/db_username" },
        { name = "DB_PASS", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/etherpad/db_password" },
        { name = "DB_NAME", valueFrom = "/ecs.<region_label>.<domain-slug>/rds/etherpad/db_dbname" }
      ]

      port_mappings = [
        { container_port = 9001, host_port = 9001 }
      ]

      health_check = {
        command      = ["CMD-SHELL", "curl -f http://localhost:9001/health || exit 1"]
        interval     = 60
        timeout      = 5
        retries      = 3
        start_period = 120
      }

      log_stream_prefix = "app"
    }
  ]
}
```

## Key Configuration Patterns

### Container Dependencies

Containers can depend on each other with conditions:
- `START`: Wait for container to start
- `COMPLETE`: Wait for container to complete
- `SUCCESS`: Wait for successful completion
- `HEALTHY`: Wait for health check to pass

```hcl
depends_on = [
  { container_name = "database", condition = "HEALTHY" }
]
```

### Secrets from SSM Parameter Store

All secrets are loaded from AWS SSM Parameter Store:

```hcl
secrets = [
  { name = "DATABASE_PASSWORD", valueFrom = "/path/to/ssm/parameter" }
]
```

### Health Checks

Health checks ensure containers are running correctly:

```hcl
health_check = {
  command      = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
  interval     = 30      # seconds between checks
  timeout      = 5       # seconds before timeout
  retries      = 3       # failures before unhealthy
  start_period = 120     # grace period on startup
}
```

### Port Mappings

For FARGATE, container_port and host_port must match:

```hcl
port_mappings = [
  { container_port = 443, host_port = 443, protocol = "tcp" }
]
```

### Resource Allocation

- `task_cpu` and `task_memory`: Total for the entire task
- `cpu` and `memory`: Per container
- `memory_reservation`: Soft limit (container can burst to `memory`)

```hcl
task_cpu     = 1024  # Total task CPU
task_memory  = 2048  # Total task memory

containers = [
  {
    cpu                = 512   # This container's CPU
    memory             = 1024  # Hard limit
    memory_reservation = 512   # Soft limit
  }
]
```
