import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminVerificationService } from './admin-verification.service';
import { AdminService } from './admin.service';
import { VerificationDecisionDto, VerificationQueryDto, ActionReasonDto } from './dto/admin.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminRoles } from '../common/decorators/admin-roles.decorator';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard';

/** Staff API. Everything here requires the admin role (RolesGuard) and is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@UseGuards(AdminRolesGuard)
@Controller('admin/v1')
export class AdminController {
  constructor(
    private readonly verification: AdminVerificationService,
    private readonly adminService: AdminService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Live counts for the dashboard' })
  stats() {
    return this.verification.stats();
  }

  @Get('verification-cases')
  @ApiOperation({ summary: 'Verification queue (oldest first)' })
  list(@Query() q: VerificationQueryDto) {
    return this.verification.list(q);
  }

  @Get('verification-cases/:id')
  @ApiOperation({ summary: 'Case with short-lived document links (audited)' })
  detail(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.verification.detail(id, adminId);
  }

  @Post('verification-cases/:id/reveal-reference')
  @AdminRoles('Compliance')
  @ApiOperation({ summary: 'Reveal the full ID number (Compliance role; always audited)' })
  reveal(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.verification.revealReference(id, adminId);
  }

  @Post('verification-cases/:id/decision')
  @AdminRoles('Verification', 'Operations')
  @ApiOperation({ summary: 'Approve, reject, or ask for more information' })
  decide(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: VerificationDecisionDto) {
    return this.verification.decide(id, adminId, dto);
  }

  // --- Users ---
  @Get('users')
  @AdminRoles('Operations', 'Support')
  @ApiOperation({ summary: 'Search all users' })
  searchUsers(@Query('q') query: string) {
    return this.adminService.searchUsers(query || '');
  }

  @Post('users/:id/suspend')
  @AdminRoles('Operations', 'Safety')
  @ApiOperation({ summary: 'Suspend a user' })
  suspendUser(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: ActionReasonDto) {
    return this.adminService.suspendUser(id, adminId, dto.reason);
  }

  // --- Jobs ---
  @Get('jobs')
  @AdminRoles('Operations', 'Support', 'Analytics')
  @ApiOperation({ summary: 'Live job list' })
  listJobs(@Query('status') status?: string, @Query('skip') skip?: string) {
    return this.adminService.getJobsList(status, skip ? parseInt(skip, 10) : 0);
  }

  @Post('jobs/:id/cancel')
  @AdminRoles('Operations', 'Support')
  @ApiOperation({ summary: 'Cancel a job' })
  cancelJob(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: ActionReasonDto) {
    return this.adminService.cancelJob(id, adminId, dto.reason);
  }

  // --- Safety ---
  @Get('incidents')
  @AdminRoles('Operations', 'Safety')
  @ApiOperation({ summary: 'List safety incidents' })
  listIncidents(@Query('status') status?: string, @Query('skip') skip?: string) {
    return this.adminService.getIncidents(status, skip ? parseInt(skip, 10) : 0);
  }

  // --- Payments & Ledger ---
  @Get('payments')
  @AdminRoles('Operations', 'Finance', 'Super Admin')
  @ApiOperation({ summary: 'View payments and ledger entries' })
  listPayments(@Query('skip') skip?: string) {
    return this.adminService.getPayments(skip ? parseInt(skip, 10) : 0);
  }

  // --- Catalog ---
  @Get('catalog')
  @AdminRoles('Operations', 'Content', 'Super Admin')
  @ApiOperation({ summary: 'View service catalog' })
  listCatalog() {
    return this.adminService.getCatalog();
  }

  // --- Country Config ---
  @Get('country-config')
  @AdminRoles('Operations', 'Super Admin')
  @ApiOperation({ summary: 'View country configurations' })
  getCountryConfigs() {
    return this.adminService.getCountryConfigs();
  }

  // --- Reviews Moderation ---
  @Get('reviews')
  @AdminRoles('Operations', 'Safety', 'Content', 'Super Admin')
  @ApiOperation({ summary: 'View reported reviews' })
  getReportedReviews(@Query('skip') skip?: string) {
    return this.adminService.getReportedReviews(skip ? parseInt(skip, 10) : 0);
  }

  // --- Audit Logs ---
  @Get('audit-logs')
  @AdminRoles('Auditor')
  @ApiOperation({ summary: 'View audit logs' })
  listAuditLogs(@Query('skip') skip?: string) {
    return this.adminService.getAuditLogs(skip ? parseInt(skip, 10) : 0);
  }
}
