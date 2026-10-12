import { z } from 'zod';

/**
 * Field-mapping contracts (BLD-05).
 *
 * The visual mapping's data contract: the
 * form-field → connector-field mapping the App
 * Builder's data-routing tab edits, stored on the
 * app definition's `field-mapping` section — the
 * same `mapping` shape the connector-request flow
 * (BLD-10) carries.
 */

/**
 * The mapping itself: a form field name to a
 * connector field name. String→string — a form
 * field maps to exactly one connector field.
 */
export const FieldMappingSchema = z.record(
  z.string().min(1).max(128),
  z.string().min(1).max(128),
);

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

/**
 * The PUT payload: the mapping under its
 * `field_mapping` key. `.strict()` so an unlisted
 * key is refused inline (BLD-07).
 */
export const FieldMappingPutSchema = z
  .object({
    field_mapping: FieldMappingSchema,
  })
  .strict();

export type FieldMappingPut = z.infer<
  typeof FieldMappingPutSchema
>;

/**
 * The GET/PUT response: the mapping as stored,
 * with the definition version it landed on — the
 * round-trip the BLD-05 data contract proves.
 */
export const FieldMappingResponseSchema = z
  .object({
    app_id: z.string().min(1),
    field_mapping: FieldMappingSchema,
    version: z.number().int().positive(),
  })
  .strict();

export type FieldMappingRecord = z.infer<
  typeof FieldMappingResponseSchema
>;
