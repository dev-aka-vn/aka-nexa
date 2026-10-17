/**
 * Narrow purpose-built resolver for field mapping expressions.
 * Only supports {{form.<field>}} and {{real_user.<attribute>}} grammar.
 * No eval/new Function - no arbitrary expression evaluation.
 */
import { ConnectorExecuteOutcome } from '@akane/contract';

export type MappingErrorCode =
  | 'missing_required_field'
  | 'invalid_numeric_field'
  | 'unknown_root'
  | 'empty_value'
  | 'invalid_format';

export interface MappingError {
  readonly code: MappingErrorCode;
  readonly message: string;
  readonly field: string;
}

export interface MappingResult {
  readonly success: true;
  readonly data: Record<string, unknown>;
}

export interface MappingFailure {
  readonly success: false;
  readonly error: MappingError;
  readonly outcome: ConnectorExecuteOutcome;
}

export type MappingOutcome = MappingResult | MappingFailure;

export interface FieldMappingContext {
  readonly formData: Record<string, unknown>;
  readonly realUserProfile: Record<string, unknown>;
  readonly submissionId?: string;
  readonly revision?: number | string;
  readonly correlationCustomFieldId?: string; // e.g., 'cf_123'
}

export class MappingValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'MappingValidationError';
  }
}

export class FieldMappingResolver {
  resolve(context: FieldMappingContext): MappingOutcome {
    try {
      const result: Record<string, unknown> = {};

      // The R2 attribute set - map from form data and real user profile
      // Required: subject (non-empty)
      const subject = this.resolveExpression(
        '{{form.subject}}',
        context.formData,
        context.realUserProfile,
      );
      if (!subject.success) {
        return this.createMappingFailure(subject.error, 'failed_permanent');
      }
      if (!this.isNonEmptyString(subject.value)) {
        return this.createMappingFailure(
          {
            code: 'empty_value',
            message: 'Subject is required and cannot be empty',
            field: 'subject',
          },
          'failed_permanent',
        );
      }
      result.subject = subject.value;

      // Optional fields
      const description = this.resolveOptional(
        '{{form.description}}',
        context.formData,
        context.realUserProfile,
      );
      if (description !== undefined) {
        result.description = description;
      }

      // Numeric IDs
      const projectId = this.resolveNumericOptional(
        '{{form.project_id}}',
        context.formData,
        context.realUserProfile,
        'project_id',
      );
      if (projectId !== undefined) {
        result.project_id = projectId;
      }

      const trackerId = this.resolveNumericOptional(
        '{{form.tracker_id}}',
        context.formData,
        context.realUserProfile,
        'tracker_id',
      );
      if (trackerId !== undefined) {
        result.tracker_id = trackerId;
      }

      const assignedToId = this.resolveNumericOptional(
        '{{form.assigned_to_id}}',
        context.formData,
        context.realUserProfile,
        'assigned_to_id',
      );
      if (assignedToId !== undefined) {
        result.assigned_to_id = assignedToId;
      }

      // Custom fields - if correlation custom field ID is provided, add it
      if (context.correlationCustomFieldId && context.submissionId !== undefined) {
        const correlationValue = `${context.submissionId}:${context.revision ?? 0}`;
        result.custom_fields = [
          {
            id: this.extractCustomFieldId(context.correlationCustomFieldId),
            value: correlationValue,
          },
        ];
      }

      return { success: true, data: result };
    } catch (err) {
      if (err instanceof MappingValidationError) {
        return this.createMappingFailure(
          {
            code: 'invalid_numeric_field',
            message: err.message,
            field: err.field,
          },
          'failed_permanent',
        );
      }
      return this.createMappingFailure(
        {
          code: 'invalid_format',
          message: err instanceof Error ? err.message : String(err),
          field: 'unknown',
        },
        'failed_permanent',
      );
    }
  }

  private resolveExpression(
    expr: string,
    formData: Record<string, unknown>,
    realUserProfile: Record<string, unknown>,
  ): { success: true; value: unknown } | { success: false; error: MappingError } {
    const trimmed = expr.trim();
    if (!trimmed.startsWith('{{') || !trimmed.endsWith('}}')) {
      return {
        success: false,
        error: {
          code: 'invalid_format',
          message: `Invalid expression format: ${expr}`,
          field: expr,
        },
      };
    }

    const inner = trimmed.slice(2, -2).trim();
    if (inner.startsWith('form.')) {
      const fieldPath = inner.slice('form.'.length);
      // Only flat attribute path - no deep nesting beyond single level as per plan
      const value = formData[fieldPath];
      return { success: true, value };
    } else if (inner.startsWith('real_user.')) {
      const attrPath = inner.slice('real_user.'.length);
      const value = realUserProfile[attrPath];
      return { success: true, value };
    } else {
      return {
        success: false,
        error: {
          code: 'unknown_root',
          message: `Unknown root in expression: ${inner}. Only form.* and real_user.* are supported`,
          field: inner,
        },
      };
    }
  }

  private resolveOptional(
    expr: string,
    formData: Record<string, unknown>,
    realUserProfile: Record<string, unknown>,
  ): unknown | undefined {
    const res = this.resolveExpression(expr, formData, realUserProfile);
    if (!res.success) {
      // For optional fields, treat as undefined if missing/unknown
      return undefined;
    }
    const value = res.value;
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return value;
  }

  private resolveNumericOptional(
    expr: string,
    formData: Record<string, unknown>,
    realUserProfile: Record<string, unknown>,
    fieldName: string,
  ): number | undefined {
    const res = this.resolveExpression(expr, formData, realUserProfile);
    if (!res.success) {
      return undefined;
    }
    const value = res.value;
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    // Check if it's numeric
    if (typeof value === 'number') {
      if (isNaN(value) || !isFinite(value)) {
        throw new MappingValidationError(
          `Invalid numeric value for ${fieldName}`,
          fieldName,
        );
      }
      return value;
    }
    if (typeof value === 'string') {
      // Check if it's a valid numeric string (no leading/trailing spaces, just digits)
      if (/^\d+$/.test(value)) {
        return parseInt(value, 10);
      } else {
        // Non-numeric - classify as failed_permanent per plan
        throw new MappingValidationError(
          `Invalid numeric value for ${fieldName}: ${value}`,
          fieldName,
        );
      }
    }
    throw new MappingValidationError(
      `Invalid numeric value for ${fieldName}`,
      fieldName,
    );
  }

  private isNonEmptyString(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private extractCustomFieldId(cf: string): number {
    // Extract number from 'cf_123'
    const match = cf.match(/^cf_(\d+)$/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return parseInt(cf, 10);
  }

  private createMappingFailure(
    error: MappingError,
    status: 'failed_permanent',
  ): MappingFailure {
    return {
      success: false,
      error,
      outcome: {
        externalId: null,
        status,
        code: 'mapping_error',
      } as ConnectorExecuteOutcome & { code?: string },
    };
  }
}
