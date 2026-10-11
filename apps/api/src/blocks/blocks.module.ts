import { Global, Module } from '@nestjs/common';
import { BlocksService } from './blocks.service';
import { BlocksController } from './blocks.controller';

@Global()
@Module({ controllers: [BlocksController], providers: [BlocksService], exports: [BlocksService] })
export class BlocksModule {}
