import { z } from 'zod';

export const RoleSchema = z.enum(['owner', 'admin', 'developer', 'viewer', 'billing_admin']);
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.enum([
  'organization:read',
  'organization:update',
  'members:read',
  'members:manage',
  'teams:manage',
  'projects:read',
  'projects:manage',
  'integrations:read',
  'integrations:manage',
  'settings:read',
  'settings:manage',
  'billing:read',
  'billing:manage',
  'usage:read',
  'audit:read',
  'notifications:manage',
  'feature_flags:manage',
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  status: z.enum(['active', 'suspended', 'deleted']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthIdentitySchema = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.enum(['clerk', 'auth0', 'google', 'github', 'email']),
  providerSubject: z.string(),
  email: z.string().email(),
  createdAt: z.coerce.date(),
});
export type AuthIdentity = z.infer<typeof AuthIdentitySchema>;

export const SessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  tokenHash: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  expiresAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Session = z.infer<typeof SessionSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['active', 'suspended', 'deleted']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  slug: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Team = z.infer<typeof TeamSchema>;

export const MembershipSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: RoleSchema,
  status: z.enum(['active', 'disabled']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  teamId: z.string().nullable(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(['active', 'archived']),
  metadata: z.record(z.unknown()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const InvitationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string().email(),
  role: RoleSchema,
  tokenHash: z.string(),
  invitedByUserId: z.string(),
  expiresAt: z.coerce.date(),
  acceptedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const AuditLogSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorUserId: z.string().nullable(),
  actorType: z.enum(['user', 'system', 'api_key']),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  occurredAt: z.coerce.date(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const SubscriptionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(['stripe', 'manual']),
  providerCustomerId: z.string().nullable(),
  providerSubscriptionId: z.string().nullable(),
  plan: z.enum(['free', 'starter', 'growth', 'enterprise']),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'paused']),
  currentPeriodStart: z.coerce.date().nullable(),
  currentPeriodEnd: z.coerce.date().nullable(),
  trialEndsAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const UsageMeterSchema = z.object({
  id: z.string(),
  key: z.string(),
  description: z.string(),
  aggregation: z.enum(['sum', 'max', 'last']),
  unit: z.string(),
  createdAt: z.coerce.date(),
});
export type UsageMeter = z.infer<typeof UsageMeterSchema>;

export const UsageRecordSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable(),
  meterKey: z.string(),
  quantity: z.number().int().nonnegative(),
  source: z.string(),
  idempotencyKey: z.string().nullable(),
  recordedAt: z.coerce.date(),
  metadata: z.record(z.unknown()),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

export const FeatureFlagSchema = z.object({
  key: z.string(),
  description: z.string(),
  defaultEnabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string().nullable(),
  channel: z.enum(['email', 'slack', 'webhook', 'in_app']),
  eventType: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['queued', 'sent', 'failed', 'read']),
  metadata: z.record(z.unknown()),
  createdAt: z.coerce.date(),
  sentAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const SettingSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable(),
  namespace: z.string(),
  key: z.string(),
  value: z.unknown(),
  updatedByUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Setting = z.infer<typeof SettingSchema>;

export const IntegrationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.enum(['github', 'gitlab', 'slack', 'stripe', 'vercel', 'sentry', 'custom']),
  status: z.enum(['pending', 'active', 'disabled', 'error']),
  externalAccountId: z.string().nullable(),
  scopes: z.array(z.string()),
  config: z.record(z.unknown()),
  secretRef: z.string().nullable(),
  installedByUserId: z.string().nullable(),
  installedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Integration = z.infer<typeof IntegrationSchema>;
