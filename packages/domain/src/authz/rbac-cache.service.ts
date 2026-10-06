export class RbacCacheService {
  private cache = new Map<string, { permissions: string[]; expires: number }>();

  private key(app_id: string, real_user_id: string, perm_version: number) {
    return `ak:rbac:${app_id}:${real_user_id}:${perm_version}`;
  }

  async get(app_id: string, real_user_id: string, perm_version: number) {
    const k = this.key(app_id, real_user_id, perm_version);
    const v = this.cache.get(k);
    if (v && v.expires > Date.now()) return v.permissions;
    return null;
  }

  async set(app_id: string, real_user_id: string, perm_version: number, permissions: string[]) {
    const k = this.key(app_id, real_user_id, perm_version);
    this.cache.set(k, { permissions, expires: Date.now() + 60000 });
  }

  async invalidate(app_id: string, real_user_id: string, perm_version: number) {
    const k = this.key(app_id, real_user_id, perm_version);
    this.cache.delete(k);
  }
}
