import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { MilestonesService } from './milestones.service';
import {
  AddMaterialDto, AddVisitDto, AwardDto, CancelProjectDto, CreateProjectDto, RequestChangesDto,
  StageDisputeDto, SubmitBidDto, SubmitStageDto, UpdateMaterialDto, UpdateProjectDto, UpdateVisitDto,
} from './projects.dto';

type User = { id: string; type: string };

@ApiTags('projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService, private readonly milestones: MilestonesService) {}

  @Post('projects') @Roles('customer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Post larger work for professionals to price' })
  create(@CurrentUser('id') id: string, @Body() dto: CreateProjectDto) { return this.projects.create(id, dto); }

  @Get('projects') @Roles('customer', 'worker')
  @ApiOperation({ summary: 'My projects (posted, or hired for)' })
  list(@CurrentUser() user: User, @Query('cursor') cursor?: string) { return this.projects.listMine(user, cursor); }

  @Get('workers/me/projects') @Roles('worker')
  @ApiOperation({ summary: 'Open projects near me that I can price' })
  feed(@CurrentUser('id') id: string) { return this.projects.feed(id); }

  @Get('projects/:id') @Roles('customer', 'worker')
  view(@CurrentUser() user: User, @Param('id') id: string) { return this.projects.view(user, id); }

  @Patch('projects/:id') @Roles('customer')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateProjectDto) { return this.projects.update(userId, id, dto); }

  @Post('projects/:id/publish') @Roles('customer') @HttpCode(HttpStatus.OK)
  publish(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.projects.publish(userId, id); }

  @Post('projects/:id/cancel') @Roles('customer', 'worker') @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CancelProjectDto) { return this.projects.cancel(user, id, dto.reason); }

  @Get('projects/:id/bids') @Roles('customer')
  bids(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.projects.listBids(userId, id); }

  @Put('projects/:id/bids/mine') @Roles('worker')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send or change my price' })
  bid(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: SubmitBidDto) { return this.projects.submitBid(userId, id, dto); }

  @Delete('projects/:id/bids/mine') @Roles('worker')
  withdraw(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.projects.withdrawBid(userId, id); }

  @Post('projects/:id/not-interested') @Roles('worker') @HttpCode(HttpStatus.OK)
  notInterested(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.projects.notInterested(userId, id); }

  @Post('projects/:id/award') @Roles('customer') @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hire a professional at their price' })
  award(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: AwardDto) { return this.projects.award(userId, id, dto); }

  @Post('projects/:id/materials') @Roles('customer', 'worker')
  addMaterial(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: AddMaterialDto) { return this.projects.addMaterial(userId, id, dto); }

  @Patch('projects/:id/materials/:materialId') @Roles('customer', 'worker')
  setMaterial(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('materialId') materialId: string, @Body() dto: UpdateMaterialDto) { return this.projects.setMaterialReady(userId, id, materialId, dto.isReady); }

  @Delete('projects/:id/materials/:materialId') @Roles('customer', 'worker')
  removeMaterial(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('materialId') materialId: string) { return this.projects.removeMaterial(userId, id, materialId); }

  @Post('projects/:id/visits') @Roles('customer', 'worker')
  addVisit(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: AddVisitDto) { return this.projects.addVisit(userId, id, dto); }

  @Patch('projects/:id/visits/:visitId') @Roles('customer', 'worker')
  updateVisit(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('visitId') visitId: string, @Body() dto: UpdateVisitDto) { return this.projects.updateVisit(userId, id, visitId, dto.status); }

  @Post('project-stages/:id/fund') @Roles('customer') @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pay a stage by card (held until approved); returns the payment page' })
  fund(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.milestones.fund(id, userId); }

  @Post('project-stages/:id/start') @Roles('worker') @HttpCode(HttpStatus.OK)
  start(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.milestones.start(id, userId); }

  @Post('project-stages/:id/submit') @Roles('worker') @HttpCode(HttpStatus.OK)
  submit(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: SubmitStageDto) { return this.milestones.submit(id, userId, dto); }

  @Post('project-stages/:id/request-changes') @Roles('customer') @HttpCode(HttpStatus.OK)
  changes(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: RequestChangesDto) { return this.milestones.requestChanges(id, userId, dto.note); }

  @Post('project-stages/:id/approve') @Roles('customer') @HttpCode(HttpStatus.OK)
  approve(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.milestones.approve(id, userId); }

  @Post('project-stages/:id/mark-paid') @Roles('worker') @HttpCode(HttpStatus.OK)
  markPaid(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.milestones.markPaid(id, userId); }

  @Post('project-stages/:id/dispute') @Roles('customer', 'worker') @HttpCode(HttpStatus.OK)
  dispute(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: StageDisputeDto) { return this.milestones.dispute(id, userId, dto); }
}
