import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/auth/permissions';
import { EarningsService } from './earnings.service';
import { SettlementsService } from './settlements.service';

class EarningsQuery {
  @IsOptional() @IsIn(['week', 'month']) period?: 'week' | 'month';
}
class LedgerQuery {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;
}
class ReportSettlementDto {
  /** Minor units, at most what is owed. */
  @IsInt() @Min(1) @Max(100_000_000) amount: number;
  @IsString() @MaxLength(32) rail: string;
  /** Transaction id / reference from the wallet or bank. */
  @IsString() @MinLength(3) @MaxLength(64) @Matches(/^[\w\-./ ]+$/) reference: string;
}
class SettlementQuery {
  @IsOptional() @IsIn(['PENDING', 'COMPLETED', 'FAILED']) status?: string;
}
class DecideSettlementDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@ApiTags('earnings')
@ApiBearerAuth()
@Controller()
export class MoneyController {
  constructor(private readonly earnings: EarningsService, private readonly settlements: SettlementsService) {}

  @Get('workers/me/earnings')
  @Roles('worker')
  @ApiOperation({ summary: 'Earned (confirmed cash), commission, net and what you owe, for this week or month' })
  summary(@CurrentUser('id') id: string, @Query() q: EarningsQuery) {
    return this.earnings.summary(id, q.period ?? 'week');
  }

  @Get('workers/me/ledger')
  @Roles('worker')
  @ApiOperation({ summary: 'Commission ledger, newest first' })
  ledger(@CurrentUser('id') id: string, @Query() q: LedgerQuery) {
    return this.earnings.ledger(id, q.cursor, q.limit);
  }

  @Post('workers/me/settlements')
  @Roles('worker')
  @ApiOperation({ summary: 'Report a payment of what you owe (checked by Fixli before it counts)' })
  report(@CurrentUser('id') id: string, @Body() dto: ReportSettlementDto) {
    return this.settlements.report(id, dto);
  }

  @Get('workers/me/settlements')
  @Roles('worker')
  mine(@CurrentUser('id') id: string) {
    return this.settlements.listMine(id);
  }

  @Get('admin/v1/settlements')
  @Roles('admin')
  @RequirePermission('finance.read')
  @ApiOperation({ summary: 'Reported settlements (oldest first)' })
  staffList(@Query() q: SettlementQuery) {
    return this.settlements.listForStaff(q.status);
  }

  @Post('admin/v1/settlements/:id/confirm')
  @HttpCode(200)
  @Roles('admin')
  @RequirePermission('finance.settle')
  @ApiOperation({ summary: 'Money received: reduce the worker\'s balance (audited)' })
  confirm(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: DecideSettlementDto) {
    return this.settlements.decide(id, staffId, true, dto.note);
  }

  @Post('admin/v1/settlements/:id/reject')
  @HttpCode(200)
  @Roles('admin')
  @RequirePermission('finance.settle')
  @ApiOperation({ summary: 'Not received / wrong reference (audited; the worker is told why)' })
  reject(@Param('id') id: string, @CurrentUser('id') staffId: string, @Body() dto: DecideSettlementDto) {
    return this.settlements.decide(id, staffId, false, dto.note);
  }
}
