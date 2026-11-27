import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CARD_GATEWAY, CardGateway, NoCardGateway, StripeGateway } from '../payments/card.gateway';
import { ProjectsController } from './projects.controller';
import { CardWebhookController } from './card-webhook.controller';
import { ProjectsService } from './projects.service';
import { MilestonesService } from './milestones.service';
import { ProjectMatchingService } from './project-matching.service';
import { ProjectsSweeper } from './projects.sweeper';

export function createCardGateway(config: ConfigService): CardGateway {
  if (config.get('PAYMENTS_PROVIDER') === 'stripe') {
    new Logger('Payments').log('Card payments: Stripe');
    return new StripeGateway({ secretKey: config.getOrThrow<string>('STRIPE_SECRET_KEY'), webhookSecret: config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET') });
  }
  return new NoCardGateway();
}

@Module({
  controllers: [ProjectsController, CardWebhookController],
  providers: [
    { provide: CARD_GATEWAY, inject: [ConfigService], useFactory: createCardGateway },
    ProjectsService, MilestonesService, ProjectMatchingService, ProjectsSweeper,
  ],
  exports: [ProjectsService, MilestonesService, ProjectsSweeper],
})
export class ProjectsModule {}
