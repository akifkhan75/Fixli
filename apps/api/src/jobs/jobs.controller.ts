import { JobStepPhotosDto } from './dto/job-step.dto';
import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JobsService, AuthUser } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobQueryDto } from './dto/job-query.dto';
import { RequestWorkerDto } from './dto/request-worker.dto';
import { CancelJobDto } from './dto/cancel-job.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('job-requests')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new job request (customers)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List jobs visible to the caller (paginated)' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: JobQueryDto) {
    return this.jobsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a job the caller is allowed to see' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.findById(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit request details while still open (customer)' })
  update(@Param('id') id: string, @Body() dto: UpdateJobDto, @CurrentUser() user: AuthUser) {
    return this.jobsService.update(id, dto, user);
  }

  @Post(':id/request-worker')
  @ApiOperation({ summary: 'Customer chooses a worker for an open job' })
  requestWorker(@Param('id') id: string, @Body() dto: RequestWorkerDto, @CurrentUser() user: AuthUser) {
    return this.jobsService.requestWorker(id, dto.workerId, user);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Assigned worker accepts' })
  accept(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.accept(id, user);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Assigned worker declines; job reopens' })
  decline(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.decline(id, user);
  }

  @Post(':id/en-route')
  @ApiOperation({ summary: 'Assigned worker is on the way' })
  enRoute(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.enRoute(id, user);
  }

  @Post(':id/arrive')
  @ApiOperation({ summary: 'Assigned worker has arrived' })
  arrive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.arrive(id, user);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Assigned worker starts the work' })
  start(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: JobStepPhotosDto) {
    return this.jobsService.start(id, user, dto);
  }

  @Post(':id/finish')
  @ApiOperation({ summary: 'Assigned worker finishes the work (awaiting confirmation)' })
  finish(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: JobStepPhotosDto) {
    return this.jobsService.finish(id, user, dto);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Customer confirms the work is completed' })
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.confirm(id, user);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Assigned worker marks the work complete' })
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.complete(id, user);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a job before it is completed' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CancelJobDto) {
    return this.jobsService.cancel(id, user, dto);
  }
}
