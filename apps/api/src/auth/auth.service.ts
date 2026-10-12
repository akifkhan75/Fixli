import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  COUNTRIES,
  checkPassword,
  isCountryCode,
  parsePhone,
  passwordIssueMessage,
  phoneErrorMessage,
  type CountryCode,
} from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SessionService, TokenPair } from './session.service';
import { AdminLoginDto, ChangePasswordDto, LoginDto, SignupDto, TotpActivateDto } from './dto/auth.dto';
import { StaffTwoFactorService } from './staff-two-factor.service';

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 12;
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;

export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  countryCode: true,
  locale: true,
  type: true,
  status: true,
  profileImageUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Compared against when the account does not exist, so response time doesn't reveal that.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly twoFactor: StaffTwoFactorService,
  ) {}

  private enabledCountries(): string[] {
    const v = this.config.get<string[] | string>('ENABLED_COUNTRIES') ?? ['PK'];
    return Array.isArray(v) ? v : String(v).split(',');
  }

  private requireCountry(code: string): CountryCode {
    const c = code?.toUpperCase();
    if (!isCountryCode(c)) throw new BadRequestException({ code: 'INVALID_COUNTRY', message: 'Unsupported country.' });
    if (!this.enabledCountries().includes(c)) {
      throw new BadRequestException({ code: 'COUNTRY_NOT_AVAILABLE', message: 'Fixli is not available in that country yet.' });
    }
    return c;
  }

  private normalisePhone(raw: string, country: CountryCode, requireCountry: boolean): string {
    const r = parsePhone(raw, country, { requireCountry });
    if (!r.ok || !r.e164) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: phoneErrorMessage(r.error ?? 'INVALID', country),
      });
    }
    return r.e164;
  }

  private assertPassword(password: string, phone?: string) {
    const issues = checkPassword(password, phone);
    if (issues.length) {
      throw new BadRequestException({ code: 'WEAK_PASSWORD', message: passwordIssueMessage(issues[0]), details: issues });
    }
  }

  async signup(dto: SignupDto) {
    const country = this.requireCountry(dto.countryCode);
    const phone = this.normalisePhone(dto.phone, country, true);
    this.assertPassword(dto.password, phone);

    if (await this.prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
      throw new ConflictException({ code: 'PHONE_TAKEN', message: 'That number is already registered. Try signing in.' });
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name: dto.name.trim(),
            phone,
            countryCode: country,
            locale: dto.locale ?? 'en',
            password,
            type: dto.type,
            lastLoginAt: new Date(),
          },
          select: PUBLIC_USER_SELECT,
        });
        // Workers start unapproved: they can sign in and finish onboarding but not take jobs.
        if (dto.type === 'worker') {
          await tx.worker.create({
            data: {
              id: created.id,
              activationStatus: 'ONBOARDING',
              currency: COUNTRIES[country].currency.code,
              timezone: COUNTRIES[country].timezone,
            },
          });
        }
        return created;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({ code: 'PHONE_TAKEN', message: 'That number is already registered. Try signing in.' });
      }
      throw e;
    }

    const tokens = await this.sessions.create(user, dto);
    await this.audit.record({ actorId: user.id, action: 'auth.signup', entityType: 'User', entityId: user.id, after: { type: dto.type, countryCode: country } });
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    // Login accepts the number in any format, interpreted in the chosen country.
    const country = isCountryCode(dto.countryCode?.toUpperCase()) ? (dto.countryCode.toUpperCase() as CountryCode) : 'PK';
    const parsed = parsePhone(dto.phone, country);
    const user = parsed.ok
      ? await this.prisma.user.findUnique({ where: { phone: parsed.e164 } })
      : null;
    return this.finishLogin(user, dto.password, dto, 'phone');
  }

  async adminLogin(dto: AdminLoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    // Same generic failure for "no such admin" and "not an admin".
    // Staff need a second factor (authenticator code) after the password; see StaffTwoFactorService.
    return this.finishLogin(user?.type === 'admin' ? user : null, dto.password, dto, 'email', (u) => this.twoFactor.check(u.id, dto.code));
  }

  /** Finish first-time authenticator setup: confirms the code, then signs the staff member in. */
  async activateStaffTwoFactor(dto: TotpActivateDto) {
    const { userId, recoveryCodes } = await this.twoFactor.activate(dto.setupToken, dto.code);
    const result = await this.issueSession(userId, dto, 'email');
    return { ...result, recoveryCodes };
  }

  private async finishLogin(
    user: { id: string; password: string; type: string; status: string; failedLoginAttempts: number; lockoutUntil: Date | null } | null,
    password: string,
    device: { deviceId: string; deviceName?: string; platform?: string },
    via: 'phone' | 'email',
    /** Extra check after the password (staff second factor). Throws to refuse. */
    secondFactor?: (user: { id: string }) => Promise<void>,
  ) {
    const generic = new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Phone number or password is wrong.' });

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw generic;
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      const minutes = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      });
    }

    if (!(await bcrypt.compare(password, user.password))) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockoutUntil: attempts >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null,
        },
      });
      throw generic;
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'This account is not active. Please contact support.' });
    }

    if (secondFactor) await secondFactor(user);
    return this.issueSession(user.id, device, via);
  }

  private async issueSession(userId: string, device: { deviceId: string; deviceName?: string; platform?: string }, via: 'phone' | 'email') {
    const fresh = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockoutUntil: null, lastLoginAt: new Date() },
      select: PUBLIC_USER_SELECT,
    });
    const tokens: TokenPair = await this.sessions.create(fresh, device);
    await this.audit.record({ actorId: userId, action: 'auth.login', entityType: 'User', entityId: userId, after: { via } });
    return { user: fresh, ...tokens };
  }

  refresh(refreshToken: string) {
    return this.sessions.refresh(refreshToken);
  }

  async logout(userId: string, sessionId: string) {
    await this.sessions.revoke(sessionId, userId);
    return { success: true };
  }

  listSessions(userId: string, currentSessionId: string) {
    return this.sessions.list(userId).then((rows) => rows.map((s) => ({ ...s, current: s.id === currentSessionId })));
  }

  async revokeSession(userId: string, sessionId: string) {
    const r = await this.sessions.revoke(sessionId, userId);
    if (r.count === 0) throw new BadRequestException({ code: 'NOT_FOUND', message: 'That device was not found.' });
    return { success: true };
  }

  async changePassword(userId: string, currentSessionId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Your current password is wrong.' });
    }
    this.assertPassword(dto.newPassword, user.phone ?? undefined);
    await this.prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(dto.newPassword, BCRYPT_COST) } });
    // Everyone else is signed out; this device stays.
    await this.sessions.revokeAllExcept(userId, currentSessionId);
    await this.audit.record({ actorId: userId, action: 'auth.password_changed', entityType: 'User', entityId: userId });
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER_SELECT });
    if (!user) throw new UnauthorizedException('Session is no longer valid');
    return user;
  }
}
