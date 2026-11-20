import { RequirePermission } from '../common/auth/permissions';
import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('disputes')
@ApiBearerAuth()
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @Roles('customer', 'worker')
  @ApiOperation({ summary: 'Raise a dispute on a job you are part of' })
  createDispute(@CurrentUser() user: { id: string; type: string }, @Body() dto: CreateDisputeDto) {
    return this.disputesService.createDispute(user, dto);
  }

  @Get('my-disputes')
  @ApiOperation({ summary: 'Disputes raised by you' })
  getMyDisputes(@CurrentUser('id') userId: string) {
    return this.disputesService.getUserDisputes(userId);
  }

  @Get('all')
  @Roles('admin')
  @RequirePermission('disputes.read')
  @ApiOperation({ summary: 'All disputes (admin)' })
  getAllDisputes() {
    return this.disputesService.getAllDisputes();
  }

  @Get(':id')
  @ApiOperation({ summary: 'A dispute you raised or are a party to' })
  getDisputeById(@Param('id') id: string, @CurrentUser() user: { id: string; type: string }) {
    return this.disputesService.getDisputeById(id, user);
  }

  @Patch(':id/resolve')
  @Roles('admin')
  @RequirePermission('disputes.resolve')
  @ApiOperation({ summary: 'Update/resolve a dispute (admin)' })
  updateDisputeStatus(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.disputesService.updateDisputeStatus(id, dto, adminId);
  }
}
