import { createTeamInputSchema, setTeamMembersInputSchema, teamDtoSchema, updateTeamInputSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateTeamDto extends createZodDto(createTeamInputSchema) {}
export class UpdateTeamDto extends createZodDto(updateTeamInputSchema) {}
export class SetTeamMembersDto extends createZodDto(setTeamMembersInputSchema) {}
export class TeamResponse extends createZodDto(teamDtoSchema) {}
