import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DisputePaymentDto, MarkCashDto } from './dto/payment.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('job/:id/cash')
  @Roles('worker')
  @ApiOperation({ summary: 'Worker marks cash received (idempotent: one live payment per job)' })
  markCashReceived(@Param('id') jobId: string, @CurrentUser('id') workerId: string, @Body() dto: MarkCashDto) {
    return this.paymentsService.markCashReceived(jobId, workerId, dto);
  }

  @Post(':id/confirm')
  @Roles('customer')
  @ApiOperation({ summary: 'Customer confirms the cash payment (idempotent)' })
  confirmPayment(@Param('id') paymentId: string, @CurrentUser('id') customerId: string) {
    return this.paymentsService.confirmPayment(paymentId, customerId);
  }

  @Post(':id/dispute')
  @Roles('customer')
  @ApiOperation({ summary: 'Customer says they paid a different amount; opens a dispute' })
  disputePayment(@Param('id') paymentId: string, @CurrentUser('id') customerId: string, @Body() dto: DisputePaymentDto) {
    return this.paymentsService.disputePayment(paymentId, customerId, dto.claimedAmount);
  }
}
