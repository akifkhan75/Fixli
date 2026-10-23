import { Controller, Get, Post, Body, Param, Query, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { REPORT_REASONS } from './chat.service';

class BlockDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
class ReportDto {
  @IsIn(REPORT_REASONS) reason: (typeof REPORT_REASONS)[number];
  @IsOptional() @IsString() @MaxLength(1000) details?: string;
}
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  @ApiOperation({ summary: 'Your chat conversations' })
  @ApiQuery({ name: 'cursor', required: false })
  getConversations(@CurrentUser('id') userId: string, @Query('cursor') cursor?: string) {
    return this.chatService.getConversationsForUser(userId, cursor);
  }

  @Get('by-job/:jobId')
  @ApiOperation({ summary: "The job's chat (opens once the job is booked)" })
  forJob(@Param('jobId') jobId: string, @CurrentUser('id') userId: string) {
    return this.chatService.conversationForJob(jobId, userId);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Messages in a conversation you belong to' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'before', required: false })
  getMessages(
    @Param('id') id: string, 
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('before') before?: string
  ) {
    return this.chatService.getMessages(id, userId, cursor, before);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a message in a conversation you belong to' })
  sendMessage(@Param('id') id: string, @CurrentUser('id') senderId: string, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(senderId, { ...dto, threadId: id });
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a conversation as read for you' })
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.chatService.markAsRead(id, userId);
  }

  @Post(':id/block')
  @ApiOperation({ summary: 'Block the other person everywhere (chat, matching, prices)' })
  block(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: BlockDto) {
    return this.chatService.blockUser(id, userId, dto.reason);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report the other person to the Fixli safety team' })
  report(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: ReportDto) {
    return this.chatService.reportUser(id, userId, dto.reason, dto.details);
  }

  @Post(':id/typing')
  @HttpCode(204)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'I am typing (throttled to one signal per 3 s)' })
  async typing(@Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.chatService.typing(userId, id);
  }
}
