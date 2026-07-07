import type {
  AuditLog,
  AuthIdentity,
  FeatureFlag,
  Integration,
  Invitation,
  Membership,
  Notification,
  Organization,
  Project,
  Session,
  Setting,
  Subscription,
  Team,
  UsageMeter,
  UsageRecord,
  User,
} from './models.js';
import type { EventEnvelope } from './events.js';

export interface UserRepository {
  upsertFromIdentity(input: {
    email: string;
    name?: string;
    provider: AuthIdentity['provider'];
    providerSubject: string;
    now: Date;
  }): Promise<User>;
  get(id: string): Promise<User | undefined>;
}

export interface SessionRepository {
  create(session: Session): Promise<void>;
  getByTokenHash(tokenHash: string): Promise<Session | undefined>;
  revoke(id: string, revokedAt: Date): Promise<void>;
}

export interface OrganizationRepository {
  create(org: Organization): Promise<void>;
  get(id: string): Promise<Organization | undefined>;
  getBySlug(slug: string): Promise<Organization | undefined>;
  listForUser(userId: string): Promise<Organization[]>;
}

export interface MembershipRepository {
  upsert(membership: Membership): Promise<void>;
  get(organizationId: string, userId: string): Promise<Membership | undefined>;
  listByOrganization(organizationId: string): Promise<Membership[]>;
}

export interface TeamRepository {
  create(team: Team): Promise<void>;
  addMember(teamId: string, membershipId: string, now: Date): Promise<void>;
  listByOrganization(organizationId: string): Promise<Team[]>;
}

export interface ProjectRepository {
  create(project: Project): Promise<void>;
  get(id: string): Promise<Project | undefined>;
  listByOrganization(organizationId: string): Promise<Project[]>;
}

export interface InvitationRepository {
  create(invitation: Invitation): Promise<void>;
  getByTokenHash(tokenHash: string): Promise<Invitation | undefined>;
  accept(id: string, acceptedAt: Date): Promise<void>;
}

export interface AuditRepository {
  append(log: AuditLog): Promise<void>;
  listByOrganization(organizationId: string, limit?: number): Promise<AuditLog[]>;
}

export interface SubscriptionRepository {
  upsert(subscription: Subscription): Promise<void>;
  getByOrganization(organizationId: string): Promise<Subscription | undefined>;
}

export interface UsageRepository {
  upsertMeter(meter: UsageMeter): Promise<void>;
  record(record: UsageRecord): Promise<void>;
  summarize(organizationId: string): Promise<Array<{ meterKey: string; quantity: number }>>;
}

export interface FeatureFlagRepository {
  upsert(flag: FeatureFlag): Promise<void>;
  setOrganizationOverride(flagKey: string, organizationId: string, enabled: boolean, now: Date): Promise<void>;
  isEnabled(flagKey: string, organizationId: string): Promise<boolean>;
}

export interface NotificationRepository {
  enqueue(notification: Notification): Promise<void>;
  listForUser(userId: string, limit?: number): Promise<Notification[]>;
  markRead(id: string, readAt: Date): Promise<void>;
}

export interface SettingRepository {
  upsert(setting: Setting): Promise<void>;
  get(input: {
    organizationId: string;
    projectId?: string | null;
    namespace: string;
    key: string;
  }): Promise<Setting | undefined>;
  list(input: { organizationId: string; projectId?: string | null; namespace?: string }): Promise<Setting[]>;
}

export interface IntegrationRepository {
  upsert(integration: Integration): Promise<void>;
  listByOrganization(organizationId: string): Promise<Integration[]>;
}

export interface EventOutboxRepository {
  enqueue(event: EventEnvelope): Promise<void>;
  listPending(limit?: number): Promise<EventEnvelope[]>;
  markPublished(id: string, publishedAt: Date): Promise<void>;
}

export interface PlatformRepositories {
  users: UserRepository;
  sessions: SessionRepository;
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  teams: TeamRepository;
  projects: ProjectRepository;
  invitations: InvitationRepository;
  audit: AuditRepository;
  subscriptions: SubscriptionRepository;
  usage: UsageRepository;
  featureFlags: FeatureFlagRepository;
  notifications: NotificationRepository;
  settings: SettingRepository;
  integrations: IntegrationRepository;
  events: EventOutboxRepository;
}
