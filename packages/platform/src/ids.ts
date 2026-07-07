import { randomUUID } from 'node:crypto';

export type IdPrefix =
  | 'user'
  | 'auth'
  | 'sess'
  | 'org'
  | 'team'
  | 'mship'
  | 'proj'
  | 'invite'
  | 'audit'
  | 'sub'
  | 'meter'
  | 'usage'
  | 'flag'
  | 'notif'
  | 'pref'
  | 'setting'
  | 'int'
  | 'evt'
  | 'key';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
