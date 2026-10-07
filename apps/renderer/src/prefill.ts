export interface PrefillField {
  field: string;
  mode: 'prefill' | 'prefill-editable';
}

export interface PrefillConfig {
  fields: PrefillField[];
}

export interface Profile {
  real_user_id: string;
  employee_code: string;
  department: string;
  email: string;
}

export class PrefillService {
  static buildPrefill(profile: Profile | null, config: PrefillConfig): Record<string, any> {
    if (!profile || !config.fields || config.fields.length === 0) {
      return {};
    }

    const result: Record<string, any> = {};

    for (const field of config.fields) {
      const key = field.field;
      if (key in profile) {
        result[key] = (profile as any)[key];
      }
    }

    return result;
  }

  static getPrefillMode(config: PrefillConfig, fieldName: string): 'prefill' | 'prefill-editable' | undefined {
    const field = config.fields.find((f) => f.field === fieldName);
    return field?.mode;
  }
}
