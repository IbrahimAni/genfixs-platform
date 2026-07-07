import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newId } from './ids.js';
import {
  AuditLogSchema,
  AuthIdentitySchema,
  FeatureFlagSchema,
  IntegrationSchema,
  InvitationSchema,
  MembershipSchema,
  NotificationSchema,
  OrganizationSchema,
  ProjectSchema,
  SessionSchema,
  SettingSchema,
  SubscriptionSchema,
  TeamSchema,
  UsageMeterSchema,
  UsageRecordSchema,
  UserSchema,
  type AuthIdentity,
  type FeatureFlag,
  type Integration,
  type Invitation,
  type Membership,
  type Notification,
  type Organization,
  type Project,
  type Session,
  type Setting,
  type Subscription,
  type Team,
  type UsageMeter,
  type UsageRecord,
  type User,
} from './models.js';
import { EventEnvelopeSchema, type EventEnvelope } from './events.js';
import type { PlatformRepositories } from './repositories.js';

type Queryable = Pick<pg.Pool, 'query'>;

export async function createPlatformPostgresRepositories(
  connectionString: string,
): Promise<PlatformRepositories & { close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString });
  await runPlatformMigrations(pool);
  return { ...createPlatformRepositoriesFromQueryable(pool), close: () => pool.end() };
}

export async function runPlatformMigrations(db: Queryable): Promise<void> {
  const migration = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '../migrations/001_platform.sql'),
    'utf8',
  );
  await db.query(migration);
}

export function createPlatformRepositoriesFromQueryable(db: Queryable): PlatformRepositories {
  const q = (text: string, values: unknown[] = []) => db.query(text, values);

  return {
    users: {
      async upsertFromIdentity(input) {
        const existingIdentity = await q(`SELECT user_id FROM platform_auth_identities WHERE provider=$1 AND provider_subject=$2`, [
          input.provider,
          input.providerSubject,
        ]);
        if (existingIdentity.rows[0]) {
          const user = await q(`SELECT * FROM platform_users WHERE id=$1`, [
            existingIdentity.rows[0].user_id,
          ]);
          return parseUser(user.rows[0]);
        }
        const existingUser = await q(`SELECT * FROM platform_users WHERE email=$1`, [input.email]);
        const user: User = existingUser.rows[0]
          ? parseUser(existingUser.rows[0])
          : {
              id: newId('user'),
              email: input.email,
              name: input.name ?? null,
              avatarUrl: null,
              status: 'active',
              createdAt: input.now,
              updatedAt: input.now,
            };
        await q(
          `INSERT INTO platform_users (id,email,name,avatar_url,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (email) DO UPDATE SET name=COALESCE(EXCLUDED.name, platform_users.name), updated_at=$7`,
          [user.id, user.email, user.name, user.avatarUrl, user.status, user.createdAt, input.now],
        );
        const identity: AuthIdentity = {
          id: newId('auth'),
          userId: user.id,
          provider: input.provider,
          providerSubject: input.providerSubject,
          email: input.email,
          createdAt: input.now,
        };
        await q(
          `INSERT INTO platform_auth_identities (id,user_id,provider,provider_subject,email,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (provider, provider_subject) DO NOTHING`,
          [
            identity.id,
            identity.userId,
            identity.provider,
            identity.providerSubject,
            identity.email,
            identity.createdAt,
          ],
        );
        return user;
      },
      async get(id) {
        const result = await q(`SELECT * FROM platform_users WHERE id=$1`, [id]);
        return result.rows[0] ? parseUser(result.rows[0]) : undefined;
      },
    },
    sessions: {
      async create(session) {
        await q(
          `INSERT INTO platform_sessions (id,user_id,token_hash,ip_address,user_agent,expires_at,revoked_at,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            session.id,
            session.userId,
            session.tokenHash,
            session.ipAddress,
            session.userAgent,
            session.expiresAt,
            session.revokedAt,
            session.createdAt,
          ],
        );
      },
      async getByTokenHash(tokenHash) {
        const result = await q(`SELECT * FROM platform_sessions WHERE token_hash=$1`, [tokenHash]);
        return result.rows[0] ? parseSession(result.rows[0]) : undefined;
      },
      async revoke(id, revokedAt) {
        await q(`UPDATE platform_sessions SET revoked_at=$2 WHERE id=$1`, [id, revokedAt]);
      },
    },
    organizations: {
      async create(org) {
        await q(
          `INSERT INTO platform_organizations (id,slug,name,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [org.id, org.slug, org.name, org.status, org.createdAt, org.updatedAt],
        );
      },
      async get(id) {
        const result = await q(`SELECT * FROM platform_organizations WHERE id=$1`, [id]);
        return result.rows[0] ? parseOrganization(result.rows[0]) : undefined;
      },
      async getBySlug(slug) {
        const result = await q(`SELECT * FROM platform_organizations WHERE slug=$1`, [slug]);
        return result.rows[0] ? parseOrganization(result.rows[0]) : undefined;
      },
      async listForUser(userId) {
        const result = await q(
          `SELECT o.* FROM platform_organizations o
           INNER JOIN platform_memberships m ON m.organization_id=o.id
           WHERE m.user_id=$1 AND m.status='active'
           ORDER BY o.created_at`,
          [userId],
        );
        return result.rows.map(parseOrganization);
      },
    },
    memberships: {
      async upsert(membership) {
        await q(
          `INSERT INTO platform_memberships (id,organization_id,user_id,role,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (organization_id, user_id) DO UPDATE SET role=$4, status=$5, updated_at=$7`,
          [
            membership.id,
            membership.organizationId,
            membership.userId,
            membership.role,
            membership.status,
            membership.createdAt,
            membership.updatedAt,
          ],
        );
      },
      async get(organizationId, userId) {
        const result = await q(
          `SELECT * FROM platform_memberships WHERE organization_id=$1 AND user_id=$2`,
          [organizationId, userId],
        );
        return result.rows[0] ? parseMembership(result.rows[0]) : undefined;
      },
      async listByOrganization(organizationId) {
        const result = await q(
          `SELECT * FROM platform_memberships WHERE organization_id=$1 ORDER BY created_at`,
          [organizationId],
        );
        return result.rows.map(parseMembership);
      },
    },
    teams: {
      async create(team) {
        await q(
          `INSERT INTO platform_teams (id,organization_id,slug,name,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (organization_id, slug) DO NOTHING`,
          [team.id, team.organizationId, team.slug, team.name, team.createdAt, team.updatedAt],
        );
      },
      async addMember(teamId, membershipId, now) {
        await q(
          `INSERT INTO platform_team_memberships (team_id,membership_id,created_at)
           VALUES ($1,$2,$3) ON CONFLICT (team_id, membership_id) DO NOTHING`,
          [teamId, membershipId, now],
        );
      },
      async listByOrganization(organizationId) {
        const result = await q(`SELECT * FROM platform_teams WHERE organization_id=$1 ORDER BY name`, [
          organizationId,
        ]);
        return result.rows.map(parseTeam);
      },
    },
    projects: {
      async create(project) {
        await q(
          `INSERT INTO platform_projects (id,organization_id,team_id,slug,name,status,metadata,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            project.id,
            project.organizationId,
            project.teamId,
            project.slug,
            project.name,
            project.status,
            JSON.stringify(project.metadata),
            project.createdAt,
            project.updatedAt,
          ],
        );
      },
      async get(id) {
        const result = await q(`SELECT * FROM platform_projects WHERE id=$1`, [id]);
        return result.rows[0] ? parseProject(result.rows[0]) : undefined;
      },
      async listByOrganization(organizationId) {
        const result = await q(
          `SELECT * FROM platform_projects WHERE organization_id=$1 ORDER BY created_at`,
          [organizationId],
        );
        return result.rows.map(parseProject);
      },
    },
    invitations: {
      async create(invitation) {
        await q(
          `INSERT INTO platform_invitations (id,organization_id,email,role,token_hash,invited_by_user_id,expires_at,accepted_at,revoked_at,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            invitation.id,
            invitation.organizationId,
            invitation.email,
            invitation.role,
            invitation.tokenHash,
            invitation.invitedByUserId,
            invitation.expiresAt,
            invitation.acceptedAt,
            invitation.revokedAt,
            invitation.createdAt,
          ],
        );
      },
      async getByTokenHash(tokenHash) {
        const result = await q(`SELECT * FROM platform_invitations WHERE token_hash=$1`, [tokenHash]);
        return result.rows[0] ? parseInvitation(result.rows[0]) : undefined;
      },
      async accept(id, acceptedAt) {
        await q(`UPDATE platform_invitations SET accepted_at=$2 WHERE id=$1`, [id, acceptedAt]);
      },
    },
    audit: {
      async append(log) {
        await q(
          `INSERT INTO platform_audit_logs (id,organization_id,actor_user_id,actor_type,action,target_type,target_id,metadata,ip_address,user_agent,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            log.id,
            log.organizationId,
            log.actorUserId,
            log.actorType,
            log.action,
            log.targetType,
            log.targetId,
            JSON.stringify(log.metadata),
            log.ipAddress,
            log.userAgent,
            log.occurredAt,
          ],
        );
      },
      async listByOrganization(organizationId, limit = 100) {
        const result = await q(
          `SELECT * FROM platform_audit_logs WHERE organization_id=$1 ORDER BY occurred_at DESC LIMIT $2`,
          [organizationId, limit],
        );
        return result.rows.map((row) =>
          AuditLogSchema.parse({
            id: row.id,
            organizationId: row.organization_id,
            actorUserId: row.actor_user_id,
            actorType: row.actor_type,
            action: row.action,
            targetType: row.target_type,
            targetId: row.target_id,
            metadata: row.metadata,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            occurredAt: row.occurred_at,
          }),
        );
      },
    },
    subscriptions: {
      async upsert(subscription) {
        await q(
          `INSERT INTO platform_subscriptions (id,organization_id,provider,provider_customer_id,provider_subscription_id,plan,status,current_period_start,current_period_end,trial_ends_at,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (organization_id) DO UPDATE SET provider=$3, provider_customer_id=$4, provider_subscription_id=$5, plan=$6, status=$7, current_period_start=$8, current_period_end=$9, trial_ends_at=$10, updated_at=$12`,
          [
            subscription.id,
            subscription.organizationId,
            subscription.provider,
            subscription.providerCustomerId,
            subscription.providerSubscriptionId,
            subscription.plan,
            subscription.status,
            subscription.currentPeriodStart,
            subscription.currentPeriodEnd,
            subscription.trialEndsAt,
            subscription.createdAt,
            subscription.updatedAt,
          ],
        );
      },
      async getByOrganization(organizationId) {
        const result = await q(`SELECT * FROM platform_subscriptions WHERE organization_id=$1`, [
          organizationId,
        ]);
        return result.rows[0] ? parseSubscription(result.rows[0]) : undefined;
      },
    },
    usage: {
      async upsertMeter(meter) {
        await q(
          `INSERT INTO platform_usage_meters (id,key,description,aggregation,unit,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (key) DO NOTHING`,
          [meter.id, meter.key, meter.description, meter.aggregation, meter.unit, meter.createdAt],
        );
      },
      async record(record) {
        await q(
          `INSERT INTO platform_usage_records (id,organization_id,project_id,meter_key,quantity,source,idempotency_key,recorded_at,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (organization_id, meter_key, idempotency_key) DO NOTHING`,
          [
            record.id,
            record.organizationId,
            record.projectId,
            record.meterKey,
            record.quantity,
            record.source,
            record.idempotencyKey,
            record.recordedAt,
            JSON.stringify(record.metadata),
          ],
        );
      },
      async summarize(organizationId) {
        const result = await q(
          `SELECT meter_key, SUM(quantity)::bigint AS quantity
           FROM platform_usage_records WHERE organization_id=$1 GROUP BY meter_key ORDER BY meter_key`,
          [organizationId],
        );
        return result.rows.map((row) => ({
          meterKey: row.meter_key as string,
          quantity: Number(row.quantity),
        }));
      },
    },
    featureFlags: {
      async upsert(flag) {
        await q(
          `INSERT INTO platform_feature_flags (key,description,default_enabled,rollout_percentage,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (key) DO UPDATE SET description=$2, default_enabled=$3, rollout_percentage=$4, updated_at=$6`,
          [
            flag.key,
            flag.description,
            flag.defaultEnabled,
            flag.rolloutPercentage,
            flag.createdAt,
            flag.updatedAt,
          ],
        );
      },
      async setOrganizationOverride(flagKey, organizationId, enabled, now) {
        await q(
          `INSERT INTO platform_feature_flag_overrides (flag_key,organization_id,enabled,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$4)
           ON CONFLICT (flag_key, organization_id) DO UPDATE SET enabled=$3, updated_at=$4`,
          [flagKey, organizationId, enabled, now],
        );
      },
      async isEnabled(flagKey, organizationId) {
        const result = await q(
          `SELECT COALESCE(o.enabled, f.default_enabled) AS enabled
           FROM platform_feature_flags f
           LEFT JOIN platform_feature_flag_overrides o ON o.flag_key=f.key AND o.organization_id=$2
           WHERE f.key=$1`,
          [flagKey, organizationId],
        );
        return Boolean(result.rows[0]?.enabled);
      },
    },
    notifications: {
      async enqueue(notification) {
        await q(
          `INSERT INTO platform_notifications (id,organization_id,user_id,channel,event_type,title,body,status,metadata,created_at,sent_at,read_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            notification.id,
            notification.organizationId,
            notification.userId,
            notification.channel,
            notification.eventType,
            notification.title,
            notification.body,
            notification.status,
            JSON.stringify(notification.metadata),
            notification.createdAt,
            notification.sentAt,
            notification.readAt,
          ],
        );
      },
      async listForUser(userId, limit = 50) {
        const result = await q(
          `SELECT * FROM platform_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
          [userId, limit],
        );
        return result.rows.map(parseNotification);
      },
      async markRead(id, readAt) {
        await q(`UPDATE platform_notifications SET status='read', read_at=$2 WHERE id=$1`, [
          id,
          readAt,
        ]);
      },
    },
    settings: {
      async upsert(setting) {
        await q(
          `INSERT INTO platform_settings (id,organization_id,project_id,namespace,key,value,updated_by_user_id,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (organization_id, project_id, namespace, key)
           DO UPDATE SET value=$6, updated_by_user_id=$7, updated_at=$9`,
          [
            setting.id,
            setting.organizationId,
            setting.projectId,
            setting.namespace,
            setting.key,
            JSON.stringify(setting.value),
            setting.updatedByUserId,
            setting.createdAt,
            setting.updatedAt,
          ],
        );
      },
      async get(input) {
        const result = await q(
          `SELECT * FROM platform_settings
           WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND namespace=$3 AND key=$4`,
          [input.organizationId, input.projectId ?? null, input.namespace, input.key],
        );
        return result.rows[0] ? parseSetting(result.rows[0]) : undefined;
      },
      async list(input) {
        const result = await q(
          `SELECT * FROM platform_settings
           WHERE organization_id=$1
             AND project_id IS NOT DISTINCT FROM $2
             AND ($3::text IS NULL OR namespace=$3)
           ORDER BY namespace, key`,
          [input.organizationId, input.projectId ?? null, input.namespace ?? null],
        );
        return result.rows.map(parseSetting);
      },
    },
    integrations: {
      async upsert(integration) {
        await q(
          `INSERT INTO platform_integrations (id,organization_id,provider,status,external_account_id,scopes,config,secret_ref,installed_by_user_id,installed_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (organization_id, provider, external_account_id)
           DO UPDATE SET status=$4, scopes=$6, config=$7, secret_ref=$8, updated_at=$11`,
          [
            integration.id,
            integration.organizationId,
            integration.provider,
            integration.status,
            integration.externalAccountId,
            integration.scopes,
            JSON.stringify(integration.config),
            integration.secretRef,
            integration.installedByUserId,
            integration.installedAt,
            integration.updatedAt,
          ],
        );
      },
      async listByOrganization(organizationId) {
        const result = await q(
          `SELECT * FROM platform_integrations WHERE organization_id=$1 ORDER BY provider`,
          [organizationId],
        );
        return result.rows.map(parseIntegration);
      },
    },
    events: {
      async enqueue(event) {
        await q(
          `INSERT INTO platform_event_outbox (id,organization_id,type,version,payload,occurred_at,published_at,attempts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            event.id,
            event.organizationId,
            event.type,
            event.version,
            JSON.stringify(event.payload),
            event.occurredAt,
            event.publishedAt,
            event.attempts,
          ],
        );
      },
      async listPending(limit = 100) {
        const result = await q(
          `SELECT * FROM platform_event_outbox WHERE published_at IS NULL ORDER BY occurred_at LIMIT $1`,
          [limit],
        );
        return result.rows.map(parseEvent);
      },
      async markPublished(id, publishedAt) {
        await q(`UPDATE platform_event_outbox SET published_at=$2 WHERE id=$1`, [id, publishedAt]);
      },
    },
  };
}

function parseUser(row: Record<string, unknown>): User {
  return UserSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseSession(row: Record<string, unknown>): Session {
  return SessionSchema.parse({
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  });
}

function parseOrganization(row: Record<string, unknown>): Organization {
  return OrganizationSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseMembership(row: Record<string, unknown>): Membership {
  return MembershipSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseTeam(row: Record<string, unknown>): Team {
  return TeamSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseProject(row: Record<string, unknown>): Project {
  return ProjectSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    teamId: row.team_id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseInvitation(row: Record<string, unknown>): Invitation {
  return InvitationSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    tokenHash: row.token_hash,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  });
}

function parseSubscription(row: Record<string, unknown>): Subscription {
  return SubscriptionSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    plan: row.plan,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseNotification(row: Record<string, unknown>): Notification {
  return NotificationSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    channel: row.channel,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    readAt: row.read_at,
  });
}

function parseSetting(row: Record<string, unknown>): Setting {
  return SettingSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function parseIntegration(row: Record<string, unknown>): Integration {
  return IntegrationSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    status: row.status,
    externalAccountId: row.external_account_id,
    scopes: row.scopes,
    config: row.config,
    secretRef: row.secret_ref,
    installedByUserId: row.installed_by_user_id,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  });
}

function parseEvent(row: Record<string, unknown>): EventEnvelope {
  return EventEnvelopeSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    version: row.version,
    payload: row.payload,
    occurredAt: row.occurred_at,
    publishedAt: row.published_at,
    attempts: row.attempts,
  });
}

void AuthIdentitySchema;
void FeatureFlagSchema;
void UsageMeterSchema;
void UsageRecordSchema;
