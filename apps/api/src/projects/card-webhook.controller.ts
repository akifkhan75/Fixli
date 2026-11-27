import { BadRequestException, Controller, Get, Header, Headers, HttpCode, HttpStatus, Inject, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CARD_GATEWAY, CardGateway } from '../payments/card.gateway';
import { MilestonesService } from './milestones.service';

/** Called by the card provider and by the browser coming back from its payment page. */
@ApiExcludeController()
@Controller('payments')
export class CardWebhookController {
  constructor(@Inject(CARD_GATEWAY) private readonly cards: CardGateway, private readonly milestones: MilestonesService) {}

  /** Public because the provider has no account: the signature over the exact bytes is the proof. */
  @Public()
  @SkipThrottle()
  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) {
    const event = req.rawBody ? this.cards.parseWebhook(req.rawBody, signature) : null;
    if (!event) throw new BadRequestException('Invalid webhook');
    if (event === 'IGNORED') return { received: true, handled: false };
    await this.milestones.applyCardEvent(event);
    return { received: true, handled: true };
  }

  /** Shows nothing sensitive and changes nothing: only the signed webhook moves money. */
  @Public()
  @Get('card/return')
  @Header('Content-Type', 'text/html; charset=utf-8')
  returned(@Query('status') status?: string) {
    const ok = status === 'success';
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixli</title>
<body style="font-family:system-ui;text-align:center;padding:48px 24px">
<h1>${ok ? 'Payment received' : 'Payment not completed'}</h1>
<p>${ok ? 'Go back to the Fixli app. The stage updates in a moment.' : 'No money was taken. Go back to the Fixli app to try again.'}</p>
<p><a href="fixli://">Open Fixli</a></p></body>`;
  }
}
