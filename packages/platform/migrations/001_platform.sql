CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS platform_users (
  id TEXT PRIMARY KEY,
  email CITEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS platform_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_organizations (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_teams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS platform_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer', 'billing_admin')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_team_memberships (
  team_id TEXT NOT NULL REFERENCES platform_teams(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES platform_memberships(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, membership_id)
);

CREATE TABLE IF NOT EXISTS platform_projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  team_id TEXT REFERENCES platform_teams(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS platform_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer', 'billing_admin')),
  token_hash TEXT UNIQUE NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'api_key')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE REFERENCES platform_organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'manual')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'starter', 'growth', 'enterprise')),
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'paused')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_usage_meters (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  aggregation TEXT NOT NULL CHECK (aggregation IN ('sum', 'max', 'last')),
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_usage_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES platform_projects(id) ON DELETE SET NULL,
  meter_key TEXT NOT NULL REFERENCES platform_usage_meters(key) ON DELETE RESTRICT,
  quantity BIGINT NOT NULL CHECK (quantity >= 0),
  source TEXT NOT NULL,
  idempotency_key TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, meter_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS platform_feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  default_enabled BOOLEAN NOT NULL,
  rollout_percentage INTEGER NOT NULL CHECK (rollout_percentage BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_feature_flag_overrides (
  flag_key TEXT NOT NULL REFERENCES platform_feature_flags(key) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (flag_key, organization_id)
);

CREATE TABLE IF NOT EXISTS platform_notification_preferences (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack', 'webhook', 'in_app')),
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, user_id, channel, event_type)
);

CREATE TABLE IF NOT EXISTS platform_notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES platform_users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'slack', 'webhook', 'in_app')),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'read')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES platform_projects(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, project_id, namespace, key)
);

CREATE TABLE IF NOT EXISTS platform_integrations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'slack', 'stripe', 'vercel', 'sentry', 'custom')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled', 'error')),
  external_account_id TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref TEXT,
  installed_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  installed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS platform_event_outbox (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES platform_organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platform_api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES platform_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  scopes TEXT[] NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES platform_users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_memberships_user ON platform_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_projects_org ON platform_projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_org_time ON platform_audit_logs(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_unpublished ON platform_event_outbox(occurred_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_platform_usage_org_meter_time ON platform_usage_records(organization_id, meter_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_notifications_user ON platform_notifications(user_id, created_at DESC);
