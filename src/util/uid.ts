/** Short, prefixed, non-cryptographic id for newly created walls and items. */
export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
