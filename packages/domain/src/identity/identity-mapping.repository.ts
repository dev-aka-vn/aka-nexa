export interface IdentityMapping {
  platform: string;
  chat_user_id: string;
  real_user_id: string;
  email?: string;
  deactivated_at?: Date | null;
}

export class IdentityMappingRepository {
  private mappings: IdentityMapping[] = [];

  async upsert(mapping: IdentityMapping): Promise<void> {
    const idx = this.mappings.findIndex(
      (m) => m.platform === mapping.platform && m.chat_user_id === mapping.chat_user_id,
    );
    if (idx >= 0) {
      this.mappings[idx] = { ...this.mappings[idx], ...mapping };
    } else {
      this.mappings.push({ ...mapping });
    }
  }

  async findByChat(platform: string, chat_user_id: string): Promise<IdentityMapping | null> {
    const m = this.mappings.find((x) => x.platform === platform && x.chat_user_id === chat_user_id);
    if (!m) return null;
    if (m.deactivated_at) return null;
    return m;
  }

  async findByEmail(email: string): Promise<IdentityMapping | null> {
    const m = this.mappings.find((x) => x.email === email && !x.deactivated_at);
    return m || null;
  }

  /**
   * Every active mapping carrying an email — the
   * IDN-07 search shape the Users page lists by
   * (a single email can map several platforms'
   * identities to the same user).
   */
  async findAllByEmail(email: string): Promise<IdentityMapping[]> {
    return this.mappings.filter(
      (x) => x.email === email && !x.deactivated_at,
    );
  }

  async findByRealUserId(real_user_id: string): Promise<IdentityMapping | null> {
    const m = this.mappings.find((x) => x.real_user_id === real_user_id && !x.deactivated_at);
    return m || null;
  }
}
