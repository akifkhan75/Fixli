import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SecretBox } from '../common/auth/secret-box';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, matchTotpStep, otpauthUrl } from '../common/auth/totp';

export const STAFF_SECURITY = Symbol('STAFF_SECURITY');
export interface StaffSecurity {
  /** Staff must use an authenticator app. Off only in tests (ADMIN_TOTP_REQUIRED=false). */
  totpRequired: boolean;
  box: SecretBox;
}

const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;
const SETUP_PURPOSE = 'staff-totp-setup';

/**
 * Second factor for staff sign-in (doc 27 F1.4): password, then a 6-digit authenticator code or a
 * one-time recovery code. First sign-in without an authenticator returns TOTP_SETUP_REQUIRED with
 * a 10-minute setup token that can only be used to enrol (it has no session, so it is not an
 * access token).
 */
@Injectable()
export class StaffTwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(STAFF_SECURITY) private readonly security: StaffSecurity,
  ) {}

  async check(userId: string, code?: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecret: true, totpEnabledAt: true, totpRecoveryHashes: true, failedLoginAttempts: true, totpLastStep: true },
    });

    if (!u.totpEnabledAt || !u.totpSecret) {
      if (!this.security.totpRequired) return;
      const setupToken = this.jwt.sign({ sub: userId, purpose: SETUP_PURPOSE }, { expiresIn: '10m' });
      throw new ForbiddenException({
        code: 'TOTP_SETUP_REQUIRED',
        message: 'Set up an authenticator app to finish signing in.',
        details: { setupToken },
      });
    }

    if (!code?.trim()) {
      throw new UnauthorizedException({ code: 'TOTP_REQUIRED', message: 'Enter the 6-digit code from your authenticator app.' });
    }

    const c = code.trim();
    const step = /^\d{6}$/.test(c) ? matchTotpStep(this.security.box.open(u.totpSecret), c) : null;
    if (step !== null) {
      // Each code works once: a code seen by someone over the shoulder can't be replayed.
      const fresh = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      if (fresh.count === 1) return;
      throw new UnauthorizedException({ code: 'CODE_ALREADY_USED', message: 'That code was already used. Wait for the next one.' });
    }

    const hash = hashRecoveryCode(c);
    if (u.totpRecoveryHashes.includes(hash)) {
      // Single use: removed in the same conditional write, so two logins can't share one code.
      const used = await this.prisma.user.updateMany({
        where: { id: userId, totpRecoveryHashes: { has: hash } },
        data: { totpRecoveryHashes: u.totpRecoveryHashes.filter((h) => h !== hash) },
      });
      if (used.count === 1) {
        await this.audit.record({ actorId: userId, action: 'auth.recovery_code_used', entityType: 'User', entityId: userId, after: { left: u.totpRecoveryHashes.length - 1 } });
        return;
      }
    }

    const attempts = (u.failedLoginAttempts ?? 0) + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: attempts, lockoutUntil: attempts >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null },
    });
    throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'That code is not right. Check the time on your phone and try again.' });
  }

  private async userFromSetupToken(token: string) {
    let payload: { sub: string; purpose?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException({ code: 'SETUP_EXPIRED', message: 'This setup link expired. Sign in again.' });
    }
    if (payload.purpose !== SETUP_PURPOSE) throw new UnauthorizedException({ code: 'SETUP_EXPIRED', message: 'Sign in again.' });
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, type: 'admin', status: 'ACTIVE' },
      select: { id: true, email: true, totpSecret: true, totpEnabledAt: true },
    });
    if (!user) throw new UnauthorizedException({ code: 'SETUP_EXPIRED', message: 'Sign in again.' });
    if (user.totpEnabledAt) throw new ForbiddenException({ code: 'TOTP_ALREADY_SET', message: 'An authenticator is already set up. Sign in with its code.' });
    return user;
  }

  /** Step 1: a new secret (stored encrypted, pending until confirmed) and the link for the QR code. */
  async begin(setupToken: string) {
    const user = await this.userFromSetupToken(setupToken);
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecret: this.security.box.seal(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email ?? user.id) };
  }

  /** Step 2: the first code proves the app is set up; recovery codes are shown once. */
  async activate(setupToken: string, code: string): Promise<{ userId: string; recoveryCodes: string[] }> {
    const user = await this.userFromSetupToken(setupToken);
    const step = user.totpSecret ? matchTotpStep(this.security.box.open(user.totpSecret), code) : null;
    if (step === null) {
      throw new UnauthorizedException({ code: 'INVALID_CODE', message: 'That code is not right. Scan the QR code again and enter the new code.' });
    }
    const { codes, hashes } = generateRecoveryCodes();
    const done = await this.prisma.user.updateMany({
      where: { id: user.id, totpEnabledAt: null },
      data: { totpEnabledAt: new Date(), totpRecoveryHashes: hashes, totpLastStep: step },
    });
    if (done.count !== 1) throw new ForbiddenException({ code: 'TOTP_ALREADY_SET', message: 'An authenticator is already set up.' });
    await this.audit.record({ actorId: user.id, action: 'auth.2fa_enabled', entityType: 'User', entityId: user.id });
    return { userId: user.id, recoveryCodes: codes };
  }
}
