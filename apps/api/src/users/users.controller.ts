import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { AccountDeletionService } from './account-deletion.service';
import { DataExportService } from './data-export.service';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly deletion: AccountDeletionService,
    private readonly dataExport: DataExportService,
  ) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List all users (admin only)' })
  findAll() {
    return this.usersService.findAll();
  }

  // "me" must be declared before ":id".
  @Get('me')
  @ApiOperation({ summary: 'Own profile' })
  me(@CurrentUser('id') id: string) {
    return this.usersService.findById(id);
  }

  @Get('me/export')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Download my own data as JSON (access request). Limited to 3 per hour.' })
  exportMyData(@CurrentUser('id') id: string) {
    return this.dataExport.export(id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own name, language or photo' })
  updateMe(@CurrentUser('id') id: string, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(id, dto);
  }

  @Delete('me')
  @ApiOperation({ summary: 'Delete own account (needs the password; refused while a job or payment is unsettled)' })
  deleteMe(@CurrentUser('id') id: string, @Body() dto: DeleteAccountDto) {
    return this.deletion.deleteAccount(id, dto.password);
  }

  @Get('me/favorites')
  @Roles('customer')
  @ApiOperation({ summary: 'Get favorite workers' })
  getFavorites(@CurrentUser('id') id: string) {
    return this.usersService.getFavorites(id);
  }

  @Post('me/favorites/:workerId')
  @Roles('customer')
  @ApiOperation({ summary: 'Add a worker to favorites' })
  addFavorite(@CurrentUser('id') id: string, @Param('workerId') workerId: string) {
    return this.usersService.addFavorite(id, workerId);
  }

  @Delete('me/favorites/:workerId')
  @Roles('customer')
  @ApiOperation({ summary: 'Remove a worker from favorites' })
  removeFavorite(@CurrentUser('id') id: string, @Param('workerId') workerId: string) {
    return this.usersService.removeFavorite(id, workerId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user. Users can only read themselves; admins can read anyone.' })
  findOne(@Param('id') id: string, @CurrentUser('id') currentUserId: string, @CurrentUser('type') currentUserType: string) {
    if (id !== currentUserId && currentUserType !== 'admin') throw new NotFoundException('User not found');
    return this.usersService.findById(id);
  }
}
