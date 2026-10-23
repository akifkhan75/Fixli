import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

/** Nothing to send: the amount is always the job's agreed total (unknown fields are rejected). */
class MarkCashDto {}

class DisputePaymentDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason: string;
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('job-requests/:id/payments/cash')
  @Roles('worker')
  @ApiOperation({ summary: 'Worker: I received the agreed amount in cash (once per job; the amount is never typed)' })
  markCash(@Param('id') jobId: string, @CurrentUser('id') workerId: string, @Body() _body: MarkCashDto) {
    return this.payments.markCashReceived(jobId, workerId);
  }

  @Post('payments/:id/confirm')
  @HttpCode(200)
  @Roles('customer')
  @ApiOperation({ summary: 'Customer: yes, I paid this' })
  confirm(@Param('id') id: string, @CurrentUser('id') customerId: string) {
    return this.payments.confirmPayment(id, customerId);
  }

  @Post('payments/:id/dispute')
  @HttpCode(200)
  @Roles('customer')
  @ApiOperation({ summary: "Customer: I didn't pay this / the amount is wrong" })
  dispute(@Param('id') id: string, @CurrentUser('id') customerId: string, @Body() dto: DisputePaymentDto) {
    return this.payments.disputePayment(id, customerId, dto.reason);
  }
}
