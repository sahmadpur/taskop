/** Escapes LIKE/ILIKE wildcards so user search text is matched literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
