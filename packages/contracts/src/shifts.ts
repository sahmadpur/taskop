import { z } from 'zod';
import { idSchema } from './common.js';
import { dayNumber, localDateSchema, localTimeSchema } from './scheduling-time.js';
import { localRangeCheck, SCHEDULING_LIMITS } from './scheduling.js';

export const shiftDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  /** null = usable at every site. */
  siteId: idSchema.nullable(),
  siteName: z.string().nullable(),
  active: z.boolean(),
});
export type ShiftDto = z.infer<typeof shiftDtoSchema>;

const shiftName = z.string().trim().min(1).max(100);

export const createShiftInputSchema = z
  .object({ name: shiftName, startTime: localTimeSchema, endTime: localTimeSchema, siteId: idSchema.nullable().optional() })
  .superRefine((v, ctx) => {
    if (v.startTime === v.endTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'scheduling.issues.shiftZeroLength' });
  });
export type CreateShiftInput = z.input<typeof createShiftInputSchema>;

/** The zero-length check needs the stored values, so the API does it on the merged result. */
export const updateShiftInputSchema = z.object({
  name: shiftName.optional(),
  startTime: localTimeSchema.optional(),
  endTime: localTimeSchema.optional(),
  siteId: idSchema.nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateShiftInput = z.input<typeof updateShiftInputSchema>;

export const shiftListQuerySchema = z.object({ active: z.stringbool().optional(), siteId: idSchema.optional() });
export type ShiftListQuery = z.input<typeof shiftListQuerySchema>;

export const rosterRowSchema = z.object({ userId: idSchema, shiftId: idSchema, date: localDateSchema });
export type RosterRow = z.infer<typeof rosterRowSchema>;

export const rosterQuerySchema = z
  .object({ siteId: idSchema, from: localDateSchema, to: localDateSchema })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.rosterMaxDays));
export type RosterQuery = z.input<typeof rosterQuerySchema>;

export const rosterDtoSchema = z.object({
  siteId: idSchema,
  from: localDateSchema,
  to: localDateSchema,
  /** Active users linked to the site (filtered by the caller's data scope). */
  users: z.array(z.object({ id: idSchema, fullName: z.string() })),
  /** Shifts usable at the site, including inactive ones that old rows may still reference. */
  shifts: z.array(shiftDtoSchema),
  rows: z.array(rosterRowSchema),
});
export type RosterDto = z.infer<typeof rosterDtoSchema>;

export const putRosterInputSchema = z
  .object({ siteId: idSchema, from: localDateSchema, to: localDateSchema, rows: z.array(rosterRowSchema).max(5000) })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.rosterMaxDays))
  .superRefine((v, ctx) => {
    v.rows.forEach((r, i) => {
      if (r.date < v.from || r.date > v.to) ctx.addIssue({ code: 'custom', path: ['rows', i, 'date'], message: 'scheduling.issues.dateOutOfRange' });
    });
  });
export type PutRosterInput = z.input<typeof putRosterInputSchema>;

export const copyRosterInputSchema = z
  .object({
    siteId: idSchema,
    sourceWeekStart: localDateSchema,
    targetWeekStarts: z.array(localDateSchema).min(1).max(SCHEDULING_LIMITS.copyMaxWeeks),
  })
  .superRefine((v, ctx) => {
    v.targetWeekStarts.forEach((d, i) => {
      const offset = dayNumber(d) - dayNumber(v.sourceWeekStart);
      if (offset === 0 || offset % 7 !== 0) ctx.addIssue({ code: 'custom', path: ['targetWeekStarts', i], message: 'errors.validation.invalid' });
    });
  });
export type CopyRosterInput = z.input<typeof copyRosterInputSchema>;

export const rosterCopyResultSchema = z.object({ rowCount: z.number().int() });
export type RosterCopyResult = z.infer<typeof rosterCopyResultSchema>;
