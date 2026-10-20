export interface AccessReviewRole {
  readonly role: string;
  readonly members: readonly string[];
}

export interface AccessReviewApp {
  readonly app_id: string;
  readonly name?: string;
  readonly roles: readonly AccessReviewRole[];
}

export interface AccessReviewReport {
  readonly quarter: string;
  readonly generated_at: string;
  readonly apps: readonly AccessReviewApp[];
  readonly role_count: number;
  readonly member_count: number;
}

export const AccessReviewSchema = {
  parse: (data: unknown): AccessReviewReport | null => {
    if (data === null || data === undefined) return null;
    const d = data as Record<string, unknown>;
    return {
      quarter: String(d.quarter ?? ''),
      generated_at: String(d.generated_at ?? ''),
      apps: Array.isArray(d.apps) ? (d.apps as AccessReviewApp[]) : [],
      role_count: Number(d.role_count ?? 0),
      member_count: Number(d.member_count ?? 0),
    };
  },
};
