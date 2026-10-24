# Build independent production images together; all artifacts stay on the runner.
group "default" {
  targets = ["gateway", "tunnel", "identity"]
}

target "gateway" {
  context    = "."
  dockerfile = "packages/auth-relay/Dockerfile"
  tags       = ["auth-relay-gateway:ci"]
  cache-from = ["type=gha,scope=auth-gateway-ci"]
  cache-to   = ["type=gha,scope=auth-gateway-ci,mode=max,ignore-error=true"]
}

target "tunnel" {
  context    = "packages/auth-relay"
  dockerfile = "Dockerfile.tunnel"
  tags       = ["auth-relay-tunnel:ci"]
  cache-from = ["type=gha,scope=auth-tunnel-ci"]
  cache-to   = ["type=gha,scope=auth-tunnel-ci,mode=max,ignore-error=true"]
}

target "identity" {
  context    = "packages/auth-relay"
  dockerfile = "Dockerfile.keycloak"
  tags       = ["auth-relay-prod:local"]
  cache-from = ["type=gha,scope=auth-production-identity"]
  cache-to   = ["type=gha,scope=auth-production-identity,mode=max,ignore-error=true"]
}
