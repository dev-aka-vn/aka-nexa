/**
 * `@akane/kernel` — dependency-free shared types (D-01).
 *
 * Zero I/O and zero runtime dependencies: if a type needs a library, it belongs
 * in `@akane/platform` or `@akane/contract`, not here. Later phases extend this
 * barrel with the shared, library-free type vocabulary; it stays import-free.
 */

/** Nominal-typing helper so IDs from different domains cannot be substituted. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
