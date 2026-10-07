import { z } from 'zod';

export const idSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime();

export const cursorQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.uuid().nullable() });

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
