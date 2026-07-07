import { z } from 'zod';

export const EventEnvelopeSchema = z.object({
  id: z.string(),
  organizationId: z.string().nullable(),
  type: z.string(),
  version: z.number().int().positive(),
  payload: z.record(z.unknown()),
  occurredAt: z.coerce.date(),
  publishedAt: z.coerce.date().nullable(),
  attempts: z.number().int().nonnegative(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const PLATFORM_EVENT_TYPES = {
  organizationCreated: 'platform.organization.created',
  userJoinedOrganization: 'platform.organization.user_joined',
  projectCreated: 'platform.project.created',
  invitationCreated: 'platform.invitation.created',
  integrationInstalled: 'platform.integration.installed',
  subscriptionChanged: 'platform.subscription.changed',
  usageRecorded: 'platform.usage.recorded',
  settingChanged: 'platform.setting.changed',
  notificationQueued: 'platform.notification.queued',
} as const;

export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[keyof typeof PLATFORM_EVENT_TYPES];
