import { z } from 'zod';

/**
 * Append-only audit log of every agent action (spec §10 cross-cutting). The
 * product's pitch is trust; the audit trail is the receipt.
 */
export const AuditEventSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  at: z.coerce.date(),
  actor: z.enum(['system', 'human']),
  type: z.enum([
    'run.ingested',
    'evidence.built',
    'diagnosis.created',
    'diagnosis.degraded',
    'action.decided',
    'heal.authored',
    'heal.rejected-by-guard',
    'verification.passed',
    'verification.failed',
    'pr.opened',
    'pr.auto-merge-enabled',
    'pr.auto-merge-refused',
    'issue.opened',
    'quarantine.added',
    'quarantine.released',
    'removal.recommended',
  ]),
  testId: z.string().optional(),
  runId: z.string().optional(),
  detail: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
