variable "lb" {
  type = object({
    use_alb = optional(bool, true)
    use_nlb = optional(bool, false)
  })
  description = "App/Net LoadBalancer configurations."
}

