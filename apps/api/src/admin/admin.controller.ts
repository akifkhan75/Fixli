import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminVerificationService } from './admin-verification.service';
import { AdminService } from './admin.service';
import {
  ActionReasonDto, IncidentQueryDto, JobListQueryDto, PageQueryDto, SetRolesDto, UserSearchDto,
  VerificationDecisionDto, VerificationQueryDto,
} from './dto/admin.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { hasPermission, RequirePermission } from '../common/auth/permissions';

/** PermissionsGuard puts the caller's roles on the request. */
const canSeePii = (req: any) => hasPermission(req.adminRoles, 'pii.view');

/**
 * Staff API. Requires the admin role (RolesGuard) and, per route, one permission (PermissionsGuard,
 * deny by default). Mutations are audited.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/v1')
export class AdminController {
  constructor(
    private readonly verification: AdminVerificationService,
    private readonly adminService: AdminService,
  ) {}

  @Get('stats')
  @RequirePermission('dashboard.view')
  @ApiOperation({ summary: 'Live counts for the dashboard' })
  stats() {
    return this.verification.stats();
  }

  @Get('verification-cases')
  @RequirePermission('verification.read')
  @ApiOperation({ summary: 'Verification queue (oldest first)' })
  list(@Query() q: VerificationQueryDto) {
    return this.verification.list(q);
  }

  @Get('verification-cases/:id')
  @RequirePermission('documents.view')
  @ApiOperation({ summary: 'Case with short-lived document links (audited)' })
  detail(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.verification.detail(id, adminId);
  }

  @Post('verification-cases/:id/decision')
  @RequirePermission('verification.decide')
  @ApiOperation({ summary: 'Approve, reject, or ask for more information' })
  decide(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: VerificationDecisionDto) {
    return this.verification.decide(id, adminId, dto);
  }

  // --- Users ---
  @Get('users')
  @RequirePermission('users.read')
  @ApiOperation({ summary: 'Search users (phone/email masked without pii.view)' })
  searchUsers(@Query() q: UserSearchDto, @Req() req: any) {
    return this.adminService.searchUsers(q.q ?? '', canSeePii(req));
  }

  @Get('users/:id')
  @RequirePermission('pii.view')
  @ApiOperation({ summary: 'One user with full contact details (audited)' })
  userDetail(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.adminService.userDetail(id, adminId);
  }

  @Post('users/:id/suspend')
  @RequirePermission('users.suspend')
  @ApiOperation({ summary: 'Suspend a user' })
  suspendUser(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: ActionReasonDto) {
    return this.adminService.suspendUser(id, adminId, dto.reason);
  }

  // --- Jobs ---
  @Get('jobs')
  @RequirePermission('jobs.read')
  @ApiOperation({ summary: 'Live job list' })
  listJobs(@Query() q: JobListQueryDto, @Req() req: any) {
    return this.adminService.getJobsList(q.status, q.skip ?? 0, 50, canSeePii(req));
  }

  @Post('jobs/:id/cancel')
  @RequirePermission('jobs.cancel')
  @ApiOperation({ summary: 'Cancel a job' })
  cancelJob(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: ActionReasonDto) {
    return this.adminService.cancelJob(id, adminId, dto.reason);
  }

  // --- Safety ---
  @Get('incidents')
  @RequirePermission('safety.read')
  @ApiOperation({ summary: 'List safety incidents' })
  listIncidents(@Query() q: IncidentQueryDto) {
    return this.adminService.getIncidents(q.status, q.skip ?? 0);
  }

  // --- Payments & Ledger ---
  @Get('payments')
  @RequirePermission('finance.read')
  @ApiOperation({ summary: 'View payments' })
  listPayments(@Query() q: PageQueryDto) {
    return this.adminService.getPayments(q.skip ?? 0);
  }

  // --- Catalog ---
  @Get('catalog')
  @RequirePermission('catalog.read')
  @ApiOperation({ summary: 'View service catalog' })
  listCatalog() {
    return this.adminService.getCatalog();
  }

  // --- Country Config ---
  @Get('country-config')
  @RequirePermission('config.read')
  @ApiOperation({ summary: 'View country configurations' })
  getCountryConfigs() {
    return this.adminService.getCountryConfigs();
  }

  // --- Reviews Moderation ---
  @Get('reviews')
  @RequirePermission('reviews.moderate')
  @ApiOperation({ summary: 'View reviews needing moderation' })
  getReportedReviews(@Query() q: PageQueryDto) {
    return this.adminService.getReportedReviews(q.skip ?? 0);
  }

  // --- Audit Logs ---
  @Get('audit-logs')
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'View audit logs' })
  listAuditLogs(@Query() q: PageQueryDto) {
    return this.adminService.getAuditLogs(q.skip ?? 0);
  }

  // --- Staff ---
  @Get('staff')
  @RequirePermission('staff.manage')
  @ApiOperation({ summary: 'Staff accounts, roles and two-factor status' })
  listStaff() {
    return this.adminService.listStaff();
  }

  @Patch('staff/:id/roles')
  @RequirePermission('staff.manage')
  @ApiOperation({ summary: 'Set a staff member\'s roles (signs them out so the change applies everywhere)' })
  setRoles(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: SetRolesDto) {
    return this.adminService.setRoles(id, adminId, dto.roles);
  }

  @Post('staff/:id/reset-2fa')
  @RequirePermission('staff.manage')
  @ApiOperation({ summary: 'Clear a staff member\'s authenticator (they set it up again at next sign-in)' })
  resetTwoFactor(@Param('id') id: string, @CurrentUser('id') adminId: string, @Body() dto: ActionReasonDto) {
    return this.adminService.resetTwoFactor(id, adminId, dto.reason);
  }
}
