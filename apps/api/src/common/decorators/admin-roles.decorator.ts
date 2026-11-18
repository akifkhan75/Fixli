import { SetMetadata } from '@nestjs/common';

export const ADMIN_ROLES_KEY = 'adminRoles';
export type AdminRole = 
  | 'Super Admin'
  | 'Operations'
  | 'Verification'
  | 'Support'
  | 'Safety'
  | 'Finance'
  | 'Content'
  | 'Analytics'
  | 'Auditor'
  | 'Compliance';

export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
