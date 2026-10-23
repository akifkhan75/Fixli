import { Controller, Post, Get, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AdminLoginDto, ChangePasswordDto, LoginDto, RefreshDto, SignupDto, TotpActivateDto, TotpSetupDto } from './dto/auth.dto';
import { StaffTwoFactorService } from './staff-two-factor.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly twoFactor: StaffTwoFactorService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  @ApiOperation({ summary: 'Register a customer or worker with phone + password' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with phone + password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff sign-in with email + password' })
  adminLogin(@Body() dto: AdminLoginDto) {
    return this.authService.adminLogin(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff: start authenticator setup (after a TOTP_SETUP_REQUIRED login)' })
  beginTotp(@Body() dto: TotpSetupDto) {
    return this.twoFactor.begin(dto.setupToken);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/totp/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff: confirm the first code; signs in and returns one-time recovery codes' })
  activateTotp(@Body() dto: TotpActivateDto) {
    return this.authService.activateStaffTwoFactor(dto);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (single use)' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of this device' })
  logout(@CurrentUser('id') userId: string, @CurrentUser('sid') sid: string) {
    return this.authService.logout(userId, sid);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user (used to restore a session)' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Devices signed in to this account' })
  sessions(@CurrentUser('id') userId: string, @CurrentUser('sid') sid: string) {
    return this.authService.listSessions(userId, sid);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign a device out' })
  revokeSession(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.authService.revokeSession(userId, id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password; signs out all other devices' })
  changePassword(
    @CurrentUser('id') userId: string,
    @CurrentUser('sid') sid: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, sid, dto);
  }
}
