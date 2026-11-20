import { Global, Module } from '@nestjs/common';
import { CountryConfigService } from './country-config.service';
import { LedgerService } from './ledger.service';
import { EarningsService } from './earnings.service';
import { SettlementsService } from './settlements.service';
import { MoneyController } from './money.controller';

/** Country money rules, the commission ledger, earnings and settlements. */
@Global()
@Module({
  controllers: [MoneyController],
  providers: [CountryConfigService, LedgerService, EarningsService, SettlementsService],
  exports: [CountryConfigService, LedgerService, EarningsService, SettlementsService],
})
export class MoneyModule {}
