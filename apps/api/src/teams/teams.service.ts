import { Injectable } from '@nestjs/common';
import type { TeamDto } from '@taskop/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { assertIdsExist } from '../common/ids-exist';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { teams, users, userTeams } from '../db/schema';
import type { CreateTeamDto, SetTeamMembersDto, UpdateTeamDto } from './dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TeamDto[]> {
    return this.select().orderBy(asc(teams.name));
  }

  async create(input: CreateTeamDto): Promise<TeamDto> {
    const { tenantId } = this.db.context();
    const [row] = await this.db
      .tx()
      .insert(teams)
      .values({ tenantId, name: input.name, description: input.description ?? null })
      .returning({ id: teams.id });
    const dto = await this.get(row!.id);
    await this.audit.record({ action: 'team.created', entityType: 'team', entityId: dto.id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateTeamDto): Promise<TeamDto> {
    const before = await this.get(id);
    await this.db
      .tx()
      .update(teams)
      .set({ name: input.name, description: input.description, active: input.active, updatedAt: new Date() })
      .where(eq(teams.id, id));
    const after = await this.get(id);
    await this.audit.record({ action: 'team.updated', entityType: 'team', entityId: id, before, after });
    return after;
  }

  async setMembers(id: string, input: SetTeamMembersDto): Promise<TeamDto> {
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    const before = await this.get(id);
    const userIds = [...new Set(input.userIds)];
    await assertIdsExist(tx, users, users.id, userIds);
    await tx.delete(userTeams).where(eq(userTeams.teamId, id));
    if (userIds.length) await tx.insert(userTeams).values(userIds.map((userId) => ({ tenantId, userId, teamId: id })));
    const after = await this.get(id);
    await this.audit.record({
      action: 'team.members_changed',
      entityType: 'team',
      entityId: id,
      before: { memberIds: before.memberIds },
      after: { memberIds: after.memberIds },
    });
    return after;
  }

  private select() {
    return this.db
      .tx()
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        active: teams.active,
        memberIds: sql<string[]>`coalesce((select array_agg(ut.user_id::text order by ut.user_id) from user_teams ut where ut.team_id = ${teams.id}), '{}')`,
      })
      .from(teams)
      .$dynamic();
  }

  private async get(id: string): Promise<TeamDto> {
    const [row] = await this.select().where(eq(teams.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }
}
