import { z } from 'zod';
import { idSchema } from './common.js';

export const teamDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  memberIds: z.array(idSchema),
});
export type TeamDto = z.infer<typeof teamDtoSchema>;

export const createTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
});
export type CreateTeamInput = z.input<typeof createTeamInputSchema>;

export const updateTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateTeamInput = z.input<typeof updateTeamInputSchema>;

export const setTeamMembersInputSchema = z.object({ userIds: z.array(idSchema).max(1000) });
export type SetTeamMembersInput = z.input<typeof setTeamMembersInputSchema>;
