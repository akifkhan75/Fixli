import { RequirePermission } from '../common/auth/permissions';
import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RecurringJobsService } from './recurring-jobs.service';
import { CreateRecurringJobDto } from './dto/recurring-job.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('recurring-jobs')
@ApiBearerAuth()
@Controller('recurring-jobs')
export class RecurringJobsController {
  constructor(private readonly recurringJobsService: RecurringJobsService) {}

  @Post('property/:propertyId')
  @Roles('customer')
  @ApiOperation({ summary: 'Set up a recurring job for one of your properties' })
  createRecurringJob(
    @Param('propertyId') propertyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRecurringJobDto,
  ) {
    return this.recurringJobsService.createRecurringJob(userId, propertyId, dto);
  }

  @Get('property/:propertyId')
  @Roles('customer')
  @ApiOperation({ summary: 'Recurring jobs for one of your properties' })
  getPropertyRecurringJobs(@Param('propertyId') propertyId: string, @CurrentUser('id') userId: string) {
    return this.recurringJobsService.getPropertyRecurringJobs(userId, propertyId);
  }

  @Patch(':id/cancel')
  @Roles('customer')
  @ApiOperation({ summary: 'Cancel one of your recurring jobs' })
  cancelRecurringJob(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.recurringJobsService.cancelRecurringJob(userId, id);
  }

  @Get('system/due')
  @Roles('admin')
  @RequirePermission('recurring.manage')
  @ApiOperation({ summary: 'All due recurring jobs (admin/system)' })
  getDueJobs() {
    return this.recurringJobsService.getDueJobs();
  }
}
