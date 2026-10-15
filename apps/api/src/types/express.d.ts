import type { Permission, ProfileScope } from '@app/shared';

export interface AuthUser {
  id: string;
  sessionId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  permissions: Permission[];
  scope: ProfileScope;
  profileName: string;
  hrScopeBusinessUnitIds: string[];
  hrScopeLocationIds: string[];
  hasReports: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
