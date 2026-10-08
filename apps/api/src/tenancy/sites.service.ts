import { Injectable } from '@nestjs/common';
import type { SiteDto } from '@taskop/contracts';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../common/app-error';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { sites, siteTypes } from '../db/schema';
import type { CreateSiteDto, MoveSiteDto, UpdateSiteDto } from './dto';

export const siteLabel = (id: string): string => id.replaceAll('-', '');

export function toSiteDto(r: typeof sites.$inferSelect): SiteDto {
  return {
    id: r.id,
    parentId: r.parentId,
    typeId: r.typeId,
    name: r.name,
    address: r.address,
    active: r.active,
    path: r.path,
    depth: r.path.split('.').length - 1,
  };
}

const isSameOrDescendant = (candidatePath: string, ancestorPath: string) =>
  candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}.`);

@Injectable()
export class SitesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SiteDto[]> {
    const rows = await this.db.tx().select().from(sites).orderBy(asc(sites.path));
    return rows.map(toSiteDto);
  }

  async create(input: CreateSiteDto): Promise<SiteDto> {
    const { tenantId } = this.db.context();
    await this.lockTree();
    await this.requireActiveType(input.typeId);
    const parent = input.parentId ? await this.find(input.parentId, 'REFERENCE_NOT_FOUND') : null;
    const id = uuidv7();
    const [row] = await this.db
      .tx()
      .insert(sites)
      .values({
        id,
        tenantId,
        parentId: parent?.id ?? null,
        typeId: input.typeId,
        name: input.name,
        address: input.address ?? null,
        path: parent ? `${parent.path}.${siteLabel(id)}` : siteLabel(id),
      })
      .returning();
    const dto = toSiteDto(row!);
    await this.audit.record({ action: 'site.created', entityType: 'site', entityId: id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateSiteDto): Promise<SiteDto> {
    const existing = await this.find(id, 'NOT_FOUND');
    if (input.typeId && input.typeId !== existing.typeId) await this.requireActiveType(input.typeId);
    const [row] = await this.db
      .tx()
      .update(sites)
      .set({ name: input.name, typeId: input.typeId, address: input.address, active: input.active, updatedAt: new Date() })
      .where(eq(sites.id, id))
      .returning();
    const dto = toSiteDto(row!);
    await this.audit.record({ action: 'site.updated', entityType: 'site', entityId: id, before: toSiteDto(existing), after: dto });
    return dto;
  }

  async move(id: string, input: MoveSiteDto): Promise<SiteDto> {
    const tx = this.db.tx();
    await this.lockTree();
    const node = await this.find(id, 'NOT_FOUND');
    const parent = input.parentId ? await this.find(input.parentId, 'REFERENCE_NOT_FOUND') : null;
    if (parent && isSameOrDescendant(parent.path, node.path)) throw new AppError('SITE_CYCLE');
    const oldPath = node.path;
    const newPath = parent ? `${parent.path}.${siteLabel(node.id)}` : siteLabel(node.id);
    const [row] = await tx
      .update(sites)
      .set({ parentId: parent?.id ?? null, path: newPath, updatedAt: new Date() })
      .where(eq(sites.id, id))
      .returning();
    await tx
      .update(sites)
      .set({
        path: sql`${newPath}::ltree || subpath(${sites.path}, nlevel(${oldPath}::ltree))`,
        updatedAt: new Date(),
      })
      .where(and(sql`${sites.path} <@ ${oldPath}::ltree`, ne(sites.id, id)));
    const dto = toSiteDto(row!);
    await this.audit.record({
      action: 'site.moved',
      entityType: 'site',
      entityId: id,
      before: { parentId: node.parentId },
      after: { parentId: dto.parentId },
    });
    return dto;
  }

  /**
   * Serialises path-changing writes within the tenant until the transaction ends, so two
   * concurrent moves can't both pass the cycle check and a create can't read a stale parent path.
   */
  private async lockTree(): Promise<void> {
    const { tenantId } = this.db.context();
    await this.db.tx().execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-tree:${tenantId}`}, 0))`);
  }

  private async find(id: string, missing: 'NOT_FOUND' | 'REFERENCE_NOT_FOUND') {
    const [row] = await this.db.tx().select().from(sites).where(eq(sites.id, id));
    if (!row) throw new AppError(missing);
    return row;
  }

  private async requireActiveType(typeId: string): Promise<void> {
    const [type] = await this.db
      .tx()
      .select({ id: siteTypes.id })
      .from(siteTypes)
      .where(and(eq(siteTypes.id, typeId), eq(siteTypes.active, true)));
    if (!type) throw new AppError('REFERENCE_NOT_FOUND');
  }
}
