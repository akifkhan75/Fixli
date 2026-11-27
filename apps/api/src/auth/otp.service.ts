import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../safety/sms.provider';

export type OtpPurpose = 'SIGNUP' | 'PASSWORD_RESET' | 'LOGIN';

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 10;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_PER_HOUR = 3;
export const SIGNUP_TOKEN_MINUTES = 15;

const WRONG = () => new BadRequestException({ code: 'INVALID_CODE', message: 'That code is wrong or has expired. Ask for a new one.' });

/** Phone one-time codes: issue, verify, and the short-lived signup token (doc 27 R5). */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private signupSecret() {
    // Distinct from the access-token secret so a signup token can never pass as an access token.
    return `${this.config.get<string>('JWT_SECRET')}:signup`;
  }

  /** Create and send a code. Enforces cooldown and an hourly cap per phone. */
  async issue(phone: string, purpose: OtpPurpose, ip?: string, deliver = true): Promise<{ resendInSeconds: number; expiresInMinutes: number }> {
    if (deliver && !this.sms.configured && this.config.get('NODE_ENV') === 'production') {
      throw new ServiceUnavailableException({ code: 'SMS_UNAVAILABLE', message: 'We cannot send codes right now. Please try again later.' });
    }
    const now = Date.now();
    const last = await this.prisma.phoneVerification.findFirst({ where: { phone, purpose }, orderBy: { createdAt: 'desc' } });
    if (last) {
      const wait = Math.ceil((last.createdAt.getTime() + OTP_COOLDOWN_SECONDS * 1000 - now) / 1000);
      if (wait > 0) {
        throw new HttpException({ code: 'OTP_COOLDOWN', message: `Please wait ${wait} seconds before asking for another code.`, details: { retryAfterSeconds: wait } }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const lastHour = await this.prisma.phoneVerification.count({ where: { phone, purpose, createdAt: { gt: new Date(now - 3_600_000) } } });
    if (lastHour >= OTP_MAX_PER_HOUR) {
      throw new HttpException({ code: 'OTP_LIMIT', message: 'Too many codes requested. Try again in an hour.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // deliver=false: the number must not receive a code (e.g. signup for an existing account), but the
    // caller still sees identical limits and responses, so the endpoint reveals nothing.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await bcrypt.hash(code, BCRYPT_COST);
    const [, row] = await this.prisma.$transaction([
      // Only one live code per phone + purpose (partial unique index).
      this.prisma.phoneVerification.updateMany({ where: { phone, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.phoneVerification.create({ data: { phone, purpose, codeHash, ip, expiresAt: new Date(now + OTP_TTL_MINUTES * 60_000), consumedAt: deliver ? null : new Date() } }),
    ]);
    if (deliver) {
      const sent = await this.sms.send(phone, `Your Fixli code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Never share it with anyone.`);
      if (this.sms.configured && !sent.ok) {
        // Don't leave the person waiting for a code that never left, or make them sit out the cooldown.
        await this.prisma.phoneVerification.delete({ where: { id: row.id } });
        throw new ServiceUnavailableException({ code: 'SMS_UNAVAILABLE', message: 'We cannot send codes right now. Please try again later.' });
      }
    }
    return { resendInSeconds: OTP_COOLDOWN_SECONDS, expiresInMinutes: OTP_TTL_MINUTES };
  }

  /** Check a code. Returns the verification id; the row stays live until `consume`. */
  async check(phone: string, purpose: OtpPurpose, code: string): Promise<string> {
    const row = await this.prisma.phoneVerification.findFirst({ where: { phone, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!row || row.expiresAt < new Date() || row.attempts >= OTP_MAX_ATTEMPTS) throw WRONG();
    // Count the try first, so parallel guesses cannot exceed the cap.
    const bumped = await this.prisma.phoneVerification.updateMany({ where: { id: row.id, attempts: row.attempts, consumedAt: null }, data: { attempts: { increment: 1 } } });
    if (bumped.count === 0) throw WRONG();
    if (!(await bcrypt.compare(code, row.codeHash))) {
      if (row.attempts + 1 >= OTP_MAX_ATTEMPTS) await this.prisma.phoneVerification.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw WRONG();
    }
    return row.id;
  }

  /** Burn a verified code (single use). False if someone else already used it. */
  async consume(id: string): Promise<boolean> {
    const r = await this.prisma.phoneVerification.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date(), verifiedAt: new Date() } });
    return r.count === 1;
  }

  /** Signup step 2: verify the code and hand back a 15-minute, single-use token bound to the phone. */
  async verifySignup(phone: string, code: string): Promise<{ signupToken: string; expiresInMinutes: number }> {
    const id = await this.check(phone, 'SIGNUP', code);
    // Mark verified but keep it unconsumed until signup uses it.
    await this.prisma.phoneVerification.update({ where: { id }, data: { verifiedAt: new Date(), expiresAt: new Date(Date.now() + SIGNUP_TOKEN_MINUTES * 60_000) } });
    const signupToken = this.jwt.sign({ vid: id, phone, purpose: 'signup' }, { secret: this.signupSecret(), expiresIn: `${SIGNUP_TOKEN_MINUTES}m` });
    return { signupToken, expiresInMinutes: SIGNUP_TOKEN_MINUTES };
  }

  /** Signup step 3: the token must be valid, for this phone, and unused. Consumes it. */
  async redeemSignupToken(token: string | undefined, phone: string): Promise<void> {
    const bad = new BadRequestException({ code: 'PHONE_NOT_VERIFIED', message: 'Please verify your phone number first.' });
    if (!token) throw bad;
    let payload: { vid: string; phone: string; purpose: string };
    try {
      payload = this.jwt.verify(token, { secret: this.signupSecret() });
    } catch {
      throw bad;
    }
    if (payload.purpose !== 'signup' || payload.phone !== phone) throw bad;
    const r = await this.prisma.phoneVerification.updateMany({
      where: { id: payload.vid, phone, purpose: 'SIGNUP', consumedAt: null, verifiedAt: { not: null } },
      data: { consumedAt: new Date() },
    });
    if (r.count !== 1) throw bad;
  }
}
