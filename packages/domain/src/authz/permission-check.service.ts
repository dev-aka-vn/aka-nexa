import { Injectable } from '@nestjs/common';
import { RbacService } from './rbac.service.js';
import { RbacCacheService } from './rbac-cache.service.js';

@Injectable()
export class PermissionCheckService {
  constructor(
    private readonly rbac: RbacService,
    private readonly cache: RbacCacheService,
  ) {}

  async check(app_id: string, real_user_id: string, permission: string, perm_version = 0): Promise<boolean> {
    const cached = await this.cache.get(app_id, real_user_id, perm_version);
    if (cached !== null) {
      return cached.includes(permission);
    }
    const has = await this.rbac.hasPermission(app_id, real_user_id, permission, perm_version);
    if (has) {
      const perms = await this.rbac.getPermissions(app_id, real_user_id);
      await this.cache.set(app_id, real_user_id, perm_version, perms);
    }
    return has;
  }
}
