export interface Profile {
  real_user_id: string;
  employee_code: string;
  department: string;
  email: string;
}

export class ProfileRepository {
  private profiles: Profile[] = [];

  async upsert(profile: Profile): Promise<void> {
    const idx = this.profiles.findIndex((p) => p.real_user_id === profile.real_user_id);
    if (idx >= 0) {
      this.profiles[idx] = { ...profile };
    } else {
      this.profiles.push({ ...profile });
    }
  }

  async findByRealUserId(real_user_id: string): Promise<Profile | null> {
    const profile = this.profiles.find((p) => p.real_user_id === real_user_id);
    return profile || null;
  }

  async findAll(): Promise<Profile[]> {
    return [...this.profiles];
  }
}
