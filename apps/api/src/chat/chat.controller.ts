import { Controller, Get, Post, Body, Param, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
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
  @ApiOperation({ summary: 'Block the other user in this conversation' })
  block(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: { reason?: string }) {
    return this.chatService.blockUser(id, userId, dto.reason);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report the other user in this conversation' })
  report(@Param('id') id: string, @CurrentUser('id') userId: string, @Body() dto: { reason: string }) {
    return this.chatService.reportUser(id, userId, dto.reason);
  }
}
