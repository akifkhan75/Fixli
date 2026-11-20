import { Controller, Get, Param, Patch, Put, Post, Delete, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorkersService } from './workers.service';
import {
  CreatePortfolioDto, SetHoursDto, SetSkillsDto, SubmitVerificationDto, UpdateWorkerDto, WorkerQueryDto,
} from './dto/update-worker.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('workers')
@ApiBearerAuth()
@Controller('workers')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  @ApiOperation({ summary: 'List active workers (public fields only)' })
  findAll(@Query() query: WorkerQueryDto) {
    return this.workers.findAll(query);
  }

  // ── "me" routes first so "me" is never treated as an id ──
  @Get('me')
  @Roles('worker')
  @ApiOperation({ summary: 'Own full profile, onboarding progress and verification status' })
  me(@CurrentUser('id') id: string) {
    return this.workers.findOwn(id);
  }

  @Patch('me')
  @Roles('worker')
  @ApiOperation({ summary: 'Update own profile' })
  update(@CurrentUser('id') id: string, @Body() dto: UpdateWorkerDto) {
    return this.workers.update(id, dto);
  }

  @Put('me/skills')
  @Roles('worker')
  setSkills(@CurrentUser('id') id: string, @Body() dto: SetSkillsDto) {
    return this.workers.setSkills(id, dto);
  }

  @Put('me/hours')
  @Roles('worker')
  setHours(@CurrentUser('id') id: string, @Body() dto: SetHoursDto) {
    return this.workers.setHours(id, dto);
  }

  @Post('me/portfolio')
  @Roles('worker')
  addPortfolio(@CurrentUser('id') id: string, @Body() dto: CreatePortfolioDto) {
    return this.workers.addPortfolio(id, dto);
  }

  @Delete('me/portfolio/:itemId')
  @Roles('worker')
  removePortfolio(@CurrentUser('id') id: string, @Param('itemId') itemId: string) {
    return this.workers.removePortfolio(id, itemId);
  }

  @Post('me/verification')
  @Roles('worker')
  @ApiOperation({ summary: 'Submit an ID / selfie / licence / insurance document for review' })
  submitVerification(@CurrentUser('id') id: string, @Body() dto: SubmitVerificationDto) {
    return this.workers.submitVerification(id, dto);
  }

  @Post('me/submit')
  @Roles('worker')
  @ApiOperation({ summary: 'Send the finished profile for admin review' })
  submit(@CurrentUser('id') id: string) {
    return this.workers.submitForReview(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public worker profile' })
  findOne(@Param('id') id: string, @CurrentUser() viewer: { id: string; type: string }) {
    return this.workers.findPublicById(id, viewer);
  }
}
