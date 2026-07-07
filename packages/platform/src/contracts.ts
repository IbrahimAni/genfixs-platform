import { z } from 'zod';
import { RoleSchema } from './models.js';

export const BootstrapWorkspaceRequestSchema = z.object({
  user: z.object({
    email: z.string().email(),
    name: z.string().min(1).optional(),
    provider: z.enum(['clerk', 'auth0', 'google', 'github', 'email']).default('email'),
    providerSubject: z.string().min(1),
  }),
  organization: z.object({
    name: z.string().min(1),
    slug: z.string().min(2).max(64).optional(),
  }),
  project: z
    .object({
      name: z.string().min(1),
      slug: z.string().min(2).max(64).optional(),
    })
    .optional(),
});
export type BootstrapWorkspaceRequest = z.infer<typeof BootstrapWorkspaceRequestSchema>;

export const CreateInvitationRequestSchema = z.object({
  organizationId: z.string(),
  email: z.string().email(),
  role: RoleSchema,
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const CreateProjectRequestSchema = z.object({
  organizationId: z.string(),
  teamId: z.string().nullable().optional(),
  name: z.string().min(1),
  slug: z.string().min(2).max(64).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const RecordUsageRequestSchema = z.object({
  organizationId: z.string(),
  projectId: z.string().nullable().optional(),
  meterKey: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  source: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type RecordUsageRequest = z.infer<typeof RecordUsageRequestSchema>;

export const UpsertSettingRequestSchema = z.object({
  organizationId: z.string(),
  projectId: z.string().nullable().optional(),
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
});
export type UpsertSettingRequest = z.infer<typeof UpsertSettingRequestSchema>;
