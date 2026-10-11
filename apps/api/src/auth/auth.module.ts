import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { STAFF_SECURITY, StaffTwoFactorService } from './staff-two-factor.service';
import { SecretBox } from '../common/auth/secret-box';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '15m'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService, SessionService, JwtStrategy, StaffTwoFactorService,
    {
      provide: STAFF_SECURITY,
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        totpRequired: c.get<boolean>('ADMIN_TOTP_REQUIRED') !== false,
        box: new SecretBox(c.get<string>('TOTP_ENCRYPTION_KEY'), c.get<string>('JWT_SECRET') ?? ''),
      }),
    },
  ],
  exports: [AuthService, SessionService, JwtModule],
})
export class AuthModule {}
