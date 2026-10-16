/**
 * The key tree of a translation namespace with every leaf widened to `string`: another language `satisfies`
 * `Shape<typeof azNamespace>`, so a missing or extra key is a type error, and the runtime test in i18n.test.ts checks
 * the `{{placeholders}}` too.
 */
export type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
