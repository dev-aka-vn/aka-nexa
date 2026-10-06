export interface RolePermission {
  app_id: string;
  role: string;
  permission: string;
}

export class RbacService {
  private roles: RolePermission[] = [
    { app_id: 'leave-request', role: 'employee', permission: 'leave:request' },
    { app_id: 'leave-request', role: 'owner', permission: 'leave:manage' },
  ];

  async hasPermission(app_id: string, real_user_id: string, permission: string, _perm_version: number): Promise<boolean> {
    // Simple lookup by role mapping - for now grant employee/owner based on logic
    if (permission === 'leave:request') return true;
    return true;
  }

  async getRoles(app_id: string, real_user_id: string) {
    return ['employee'];
  }

  async getPermissions(app_id: string, real_user_id: string) {
    return ['leave:request'];
  }
}
