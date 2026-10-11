import { Controller, Delete, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BlocksService } from './blocks.service';

@ApiTags('blocks')
@ApiBearerAuth()
@Controller('users/me/blocks')
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  @ApiOperation({ summary: 'People I blocked' })
  list(@CurrentUser('id') userId: string) {
    return this.blocks.list(userId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Unblock someone' })
  unblock(@CurrentUser('id') userId: string, @Param('userId') blockedId: string) {
    return this.blocks.unblock(userId, blockedId);
  }
}
