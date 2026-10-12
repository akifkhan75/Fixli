import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/auth/permissions';
import { AdminConsoleService } from './admin-console.service';
import {
  AdjustmentDto, AuditQuery, CountryConfigDto, CreateStaffDto, FlagDto, IncidentListQuery, IncidentUpdateDto, IssueDto,
  ModerateReviewDto, PaymentQuery, PriceBandDto, RangeQuery, ReasonDto, UpdateCategoryContentDto,
} from './dto/console.dto';

/** Staff portal pages (doc 27 F6). One permission per route; changes are audited in the service. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/v1')
export class AdminConsoleController {
  constructor(private readonly c: AdminConsoleService) {}

  @Get('me')
  @RequirePermission('dashboard.view')
  @ApiOperation({ summary: 'Who I am and what I may do (drives the portal menu)' })
  me(@CurrentUser('id') id: string) { return this.c.me(id); }

  @Get('dashboard')
  @RequirePermission('dashboard.view')
  @ApiOperation({ summary: 'Live figures: users, online workers, jobs, fill rate, time to first offer, cancellations, GMV, commission' })
  dashboard(@Query() q: RangeQuery) { return this.c.dashboard(q.from, q.to); }

  // jobs
  @Get('jobs/:id')
  @RequirePermission('jobs.read')
  job(@Param('id') id: string) { return this.c.jobDetail(id); }

  @Get('jobs/:id/transcript')
  @RequirePermission('chat.read')
  @ApiOperation({ summary: "The job's chat (audited)" })
  transcript(@Param('id') id: string, @CurrentUser('id') staffId: string) { return this.c.transcript(id, staffId); }

  @Post('jobs/:id/reassign')
  @HttpCode(200)
  @RequirePermission('jobs.manage')
  @ApiOperation({ summary: "Take a booked job back from a worker who can't come, and find someone else" })
  reassign(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: ReasonDto) { return this.c.reassignJob(id, staffId, dto.reason); }

  // users & staff
  @Post('users/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('users.suspend')
  reactivate(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: ReasonDto) { return this.c.reactivateUser(id, staffId, dto.reason); }

  @Post('staff')
  @RequirePermission('staff.manage')
  @ApiOperation({ summary: 'Create a staff account (temporary password shown once; authenticator at first sign-in)' })
  createStaff(@CurrentUser('id') staffId: string, @Body() dto: CreateStaffDto) { return this.c.createStaff(staffId, dto); }

  @Get('audit')
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'Audit log, filterable by actor, entity, action and date' })
  audit(@Query() q: AuditQuery) { return this.c.auditLogs(q); }

  // safety
  @Get('safety/incidents')
  @RequirePermission('safety.read')
  incidents(@Query() q: IncidentListQuery) { return this.c.incidents(q); }

  @Get('safety/incidents/:id')
  @RequirePermission('safety.read')
  incident(@Param('id') id: string) { return this.c.incident(id); }

  @Patch('safety/incidents/:id')
  @RequirePermission('safety.manage')
  updateIncident(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: IncidentUpdateDto) { return this.c.updateIncident(id, staffId, dto); }

  // finance
  @Get('finance/payments')
  @RequirePermission('finance.read')
  payments(@Query() q: PaymentQuery) { return this.c.payments(q); }

  @Get('finance/balances')
  @RequirePermission('finance.read')
  @ApiOperation({ summary: 'Workers who owe commission, largest first' })
  balances() { return this.c.balances(); }

  @Get('finance/workers/:id/ledger')
  @RequirePermission('finance.read')
  workerLedger(@Param('id') id: string) { return this.c.workerLedger(id); }

  @Post('finance/workers/:id/adjustments')
  @RequirePermission('finance.adjust')
  adjust(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: AdjustmentDto) { return this.c.adjust(id, staffId, dto); }

  @Get('disputes/:id')
  @RequirePermission('disputes.read')
  @ApiOperation({ summary: 'A dispute with evidence links, payment and job' })
  dispute(@Param('id') id: string) { return this.c.disputeDetail(id); }

  // reviews
  @Get('moderation/reviews')
  @RequirePermission('reviews.moderate')
  @ApiOperation({ summary: 'Reviews flagged or reported (hidden=true for hidden ones)' })
  reviewQueue(@Query('hidden') hidden?: string) { return this.c.reviewQueue(hidden === 'true'); }

  @Post('moderation/reviews/:id')
  @HttpCode(200)
  @RequirePermission('reviews.moderate')
  moderate(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: ModerateReviewDto) { return this.c.moderateReview(id, staffId, dto); }

  // catalogue
  @Get('catalog/categories')
  @RequirePermission('catalog.read')
  catalog() { return this.c.catalog(); }

  @Patch('catalog/categories/:id')
  @RequirePermission('catalog.edit')
  updateCategory(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: UpdateCategoryContentDto) { return this.c.updateCategory(id, staffId, dto); }

  @Put('catalog/categories/:id/issues')
  @RequirePermission('catalog.edit')
  @ApiOperation({ summary: 'Add or update a common problem (by code)' })
  saveIssue(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: IssueDto) { return this.c.upsertIssue(id, staffId, dto); }

  @Get('catalog/price-bands')
  @RequirePermission('catalog.read')
  priceBands(@Query('categoryId') categoryId?: string) { return this.c.priceBands(categoryId); }

  @Put('catalog/price-bands')
  @RequirePermission('catalog.edit')
  savePriceBand(@CurrentUser('id') staffId: string, @Body() dto: PriceBandDto) { return this.c.savePriceBand(staffId, dto); }

  // configuration
  @Get('config/countries/:code')
  @RequirePermission('config.read')
  countryConfig(@Param('code') code: string) { return this.c.countryConfig(code); }

  @Put('config/countries/:code')
  @RequirePermission('config.edit')
  @ApiOperation({ summary: 'Save country settings (versioned; refused if someone saved meanwhile)' })
  saveCountry(@Param('code') code: string, @CurrentUser('id') staffId: string, @Body() dto: CountryConfigDto) { return this.c.saveCountryConfig(code, staffId, dto); }

  @Get('config/flags')
  @RequirePermission('config.read')
  flags() { return this.c.flagsList(); }

  @Put('config/flags/:key')
  @RequirePermission('config.edit')
  setFlag(@Param('key') key: string, @CurrentUser('id') staffId: string, @Body() dto: FlagDto) { return this.c.setFlag(key, staffId, dto.value); }
}
