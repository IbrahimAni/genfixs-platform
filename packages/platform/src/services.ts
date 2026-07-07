import { createHash, randomBytes } from 'node:crypto';
import {
  type BootstrapWorkspaceRequest,
  type CreateInvitationRequest,
  type CreateProjectRequest,
  type RecordUsageRequest,
  type UpsertSettingRequest,
} from './contracts.js';
import { PLATFORM_EVENT_TYPES } from './events.js';
import { newId, slugify } from './ids.js';
import type { AuditLog, Membership, Permission, Project, Subscription, UsageMeter } from './models.js';
import type { PlatformRepositories } from './repositories.js';
import { roleCan } from './rbac.js';

export interface RequestContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AuthorizationError extends Error {}

export class AuthorizationService {
  constructor(private readonly repos: PlatformRepositories) {}

  async assertPermission(organizationId: string, userId: string, permission: Permission): Promise<Membership> {
    const membership = await this.repos.memberships.get(organizationId, userId);
    if (!membership || membership.status !== 'active' || !roleCan(membership.role, permission)) {
      throw new AuthorizationError(`Missing permission ${permission}`);
    }
    return membership;
  }
}

export class PlatformService {
  readonly authz: AuthorizationService;

  constructor(private readonly repos: PlatformRepositories) {
    this.authz = new AuthorizationService(repos);
  }

  async bootstrapWorkspace(input: BootstrapWorkspaceRequest, ctx: RequestContext = {}) {
    const now = new Date();
    const user = await this.repos.users.upsertFromIdentity({
      email: input.user.email,
      ...(input.user.name ? { name: input.user.name } : {}),
      provider: input.user.provider,
      providerSubject: input.user.providerSubject,
      now,
    });
    const organization = {
      id: newId('org'),
      slug: input.organization.slug ?? slugify(input.organization.name),
      name: input.organization.name,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.organizations.create(organization);

    const membership = {
      id: newId('mship'),
      organizationId: organization.id,
      userId: user.id,
      role: 'owner' as const,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.memberships.upsert(membership);

    const team = {
      id: newId('team'),
      organizationId: organization.id,
      slug: 'platform',
      name: 'Platform',
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.teams.create(team);
    await this.repos.teams.addMember(team.id, membership.id, now);

    const subscription: Subscription = {
      id: newId('sub'),
      organizationId: organization.id,
      provider: 'manual',
      providerCustomerId: null,
      providerSubscriptionId: null,
      plan: 'free',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: null,
      trialEndsAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.subscriptions.upsert(subscription);

    let project: Project | undefined;
    if (input.project) {
      project = await this.createProject(
        {
          organizationId: organization.id,
          teamId: team.id,
          name: input.project.name,
          ...(input.project.slug ? { slug: input.project.slug } : {}),
          metadata: {},
        },
        { ...ctx, userId: user.id },
      );
    }

    await this.audit(organization.id, {
      action: 'organization.created',
      targetType: 'organization',
      targetId: organization.id,
      actorUserId: user.id,
      metadata: { source: 'bootstrap' },
      ctx,
    });
    await this.event(organization.id, PLATFORM_EVENT_TYPES.organizationCreated, {
      organizationId: organization.id,
      ownerUserId: user.id,
    });

    return { user, organization, membership, team, subscription, ...(project ? { project } : {}) };
  }

  async createProject(input: CreateProjectRequest, ctx: RequestContext = {}): Promise<Project> {
    if (ctx.userId) await this.authz.assertPermission(input.organizationId, ctx.userId, 'projects:manage');
    const now = new Date();
    const project: Project = {
      id: newId('proj'),
      organizationId: input.organizationId,
      teamId: input.teamId ?? null,
      slug: input.slug ?? slugify(input.name),
      name: input.name,
      status: 'active',
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.projects.create(project);
    await this.audit(input.organizationId, {
      action: 'project.created',
      targetType: 'project',
      targetId: project.id,
      actorUserId: ctx.userId ?? null,
      metadata: { slug: project.slug },
      ctx,
    });
    await this.event(input.organizationId, PLATFORM_EVENT_TYPES.projectCreated, {
      projectId: project.id,
      name: project.name,
    });
    return project;
  }

  async createInvitation(input: CreateInvitationRequest, ctx: RequestContext & { userId: string }) {
    await this.authz.assertPermission(input.organizationId, ctx.userId, 'members:manage');
    const now = new Date();
    const rawToken = randomBytes(32).toString('base64url');
    const invitation = {
      id: newId('invite'),
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
      tokenHash: hashSecret(rawToken),
      invitedByUserId: ctx.userId,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.repos.invitations.create(invitation);
    await this.audit(input.organizationId, {
      action: 'invitation.created',
      targetType: 'invitation',
      targetId: invitation.id,
      actorUserId: ctx.userId,
      metadata: { email: input.email, role: input.role },
      ctx,
    });
    await this.event(input.organizationId, PLATFORM_EVENT_TYPES.invitationCreated, {
      invitationId: invitation.id,
      email: input.email,
      role: input.role,
    });
    return { invitation, rawToken };
  }

  async recordUsage(input: RecordUsageRequest): Promise<void> {
    const now = new Date();
    const meter: UsageMeter = {
      id: newId('meter'),
      key: input.meterKey,
      description: input.meterKey,
      aggregation: 'sum',
      unit: 'count',
      createdAt: now,
    };
    await this.repos.usage.upsertMeter(meter);
    await this.repos.usage.record({
      id: newId('usage'),
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      meterKey: input.meterKey,
      quantity: input.quantity,
      source: input.source,
      idempotencyKey: input.idempotencyKey ?? null,
      recordedAt: now,
      metadata: input.metadata,
    });
    await this.event(input.organizationId, PLATFORM_EVENT_TYPES.usageRecorded, input);
  }

  async upsertSetting(input: UpsertSettingRequest, ctx: RequestContext = {}) {
    if (ctx.userId) await this.authz.assertPermission(input.organizationId, ctx.userId, 'settings:manage');
    const now = new Date();
    const setting = {
      id: newId('setting'),
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      updatedByUserId: ctx.userId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.settings.upsert(setting);
    await this.audit(input.organizationId, {
      action: 'setting.changed',
      targetType: 'setting',
      targetId: `${input.namespace}.${input.key}`,
      actorUserId: ctx.userId ?? null,
      metadata: { projectId: input.projectId ?? null },
      ctx,
    });
    await this.event(input.organizationId, PLATFORM_EVENT_TYPES.settingChanged, {
      namespace: input.namespace,
      key: input.key,
      projectId: input.projectId ?? null,
    });
    return setting;
  }

  private async audit(
    organizationId: string,
    input: {
      action: string;
      targetType: string;
      targetId: string | null;
      actorUserId: string | null;
      metadata: Record<string, unknown>;
      ctx: RequestContext;
    },
  ): Promise<void> {
    const log: AuditLog = {
      id: newId('audit'),
      organizationId,
      actorUserId: input.actorUserId,
      actorType: input.actorUserId ? 'user' : 'system',
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ipAddress: input.ctx.ipAddress ?? null,
      userAgent: input.ctx.userAgent ?? null,
      occurredAt: new Date(),
    };
    await this.repos.audit.append(log);
  }

  private async event(
    organizationId: string | null,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.events.enqueue({
      id: newId('evt'),
      organizationId,
      type,
      version: 1,
      payload,
      occurredAt: new Date(),
      publishedAt: null,
      attempts: 0,
    });
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
