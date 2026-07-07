import type { Permission, Role } from './models.js';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
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
  ],
  admin: [
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
    'usage:read',
    'audit:read',
    'notifications:manage',
  ],
  developer: [
    'organization:read',
    'members:read',
    'projects:read',
    'projects:manage',
    'integrations:read',
    'settings:read',
    'usage:read',
  ],
  viewer: ['organization:read', 'members:read', 'projects:read', 'integrations:read', 'settings:read'],
  billing_admin: ['organization:read', 'members:read', 'billing:read', 'billing:manage', 'usage:read'],
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
