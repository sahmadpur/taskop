import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { TeamDto } from '@taskop/contracts';
import { RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateTeamDto, SetTeamMembersDto, TeamResponse, UpdateTeamDto } from './dto';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission('teams.view')
  @ApiOkResponse({ type: [TeamResponse] })
  list(): Promise<TeamDto[]> {
    return this.teams.list();
  }

  @Post()
  @RequirePermission('teams.manage')
  create(@Body() body: CreateTeamDto): Promise<TeamDto> {
    return this.teams.create(body);
  }

  @Patch(':id')
  @RequirePermission('teams.manage')
  update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateTeamDto): Promise<TeamDto> {
    return this.teams.update(id, body);
  }

  @Put(':id/members')
  @RequirePermission('teams.manage')
  setMembers(@Param('id', ParseIdPipe) id: string, @Body() body: SetTeamMembersDto): Promise<TeamDto> {
    return this.teams.setMembers(id, body);
  }
}
