# Disposable compatibility images only. This builds no infrastructure or live data.
group "default" {
  targets = ["identity", "broker", "mock"]
}

target "identity" {
  context    = "packages/auth-relay"
  dockerfile = "Dockerfile.keycloak"
  args       = { KC_CACHE = "ispn" }
  tags       = ["auth-relay-test:local"]
  cache-from = ["type=gha,scope=auth-fixture-identity"]
  cache-to   = ["type=gha,scope=auth-fixture-identity,mode=max,ignore-error=true"]
}

target "broker" {
  context    = "packages/auth-relay/tests"
  dockerfile = "Dockerfile.broker"
  args       = { AUTH_TEST_BASE = "fixture-base" }
  contexts   = { fixture-base = "target:identity" }
  tags       = ["auth-relay-fixture:local"]
  cache-from = ["type=gha,scope=auth-fixture-broker"]
  cache-to   = ["type=gha,scope=auth-fixture-broker,mode=max,ignore-error=true"]
}

target "mock" {
  context    = "packages/auth-relay/tests"
  dockerfile = "Dockerfile.mock"
  tags       = ["auth-relay-mock:local"]
  cache-from = ["type=gha,scope=auth-fixture-mock"]
  cache-to   = ["type=gha,scope=auth-fixture-mock,mode=max,ignore-error=true"]
}
