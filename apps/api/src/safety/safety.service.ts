import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isCountryCode, parsePhone, phoneErrorMessage, type CountryCode } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { DomainEvents } from '../common/events/domain-events';
import { AuditService } from '../common/audit/audit.service';
import { CountryConfigService } from '../money/country-config.service';
import { AddTrustedContactDto, PROPERTY_KINDS, ReportIncidentDto, SosDto, SosKind } from './dto/safety.dto';
import { SMS_PROVIDER, SmsProvider } from './sms.provider';
import { SosService } from './sos.service';
import { CONTACT_ALERT_RESULT, trustedContactSms } from './safety-copy';

const MAX_CONTACTS = 5;
const NON_URGENT_PER_HOUR = 5;
const CATEGORY_FOR: Record<string, string> = { WATER: 'PLUMBING', ELECTRIC: 'ELECTRICAL', GAS: 'PLUMBING' };
const DESCRIPTION_FOR: Record<string, string> = {
  WATER: 'Emergency: water leak / burst pipe',
  ELECTRIC: 'Emergency: electrical hazard (sparks, burning smell, shock risk)',
  GAS: 'Emergency: gas smell',
};

/**
 * Safety (doc 24 Phase 10, doc 27 F5):
 *  - life-threatening SOS: emergency numbers to call, the safety team and trusted contacts told,
 *    and NEVER a worker sent;
 *  - property emergency (water, electric, gas): an urgent job offered to the nearest free worker;
 *  - in-job SOS for either side; "report a problem"; trusted contacts.
 * Works without any payment method or subscription.
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly sos: SosService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    private readonly countries: CountryConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** The signed-in person's country's numbers (from CountryConfig; the app caches them for offline use). */
  async emergencyNumbers(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { countryCode: true } });
    const c = await this.countries.get(u?.countryCode);
    return { countryCode: c.countryCode, numbers: c.emergencyNumbers };
  }

  async raiseSos(user: { id: string; type: string }, dto: SosDto) {
    // A retry (bad signal, double tap) returns the same emergency.
    const key = `sos:${user.id}:${dto.idempotencyKey}`;
    const prior = await this.prisma.incident.findUnique({ where: { idempotencyKey: key } });
    if (prior) return this.result(prior.id, user.id);

    if (PROPERTY_KINDS.includes(dto.kind)) return this.propertyEmergency(user, dto, key);
    return this.personalEmergency(user, dto, key);
  }

  /** Life-threatening or in-job: tell people, give numbers. No dispatch, ever. */
  private async personalEmergency(user: { id: string; type: string }, dto: SosDto, key: string) {
    let targetId: string | null = null;
    let jobRequestId: string | null = null;
    if (dto.kind === 'IN_JOB') {
      if (!dto.jobRequestId) throw new BadRequestException({ code: 'JOB_REQUIRED', message: 'Which job is this about?' });
      const job = await this.prisma.jobRequest.findFirst({ where: { id: dto.jobRequestId, OR: [{ customerId: user.id }, { assignedWorkerId: user.id }] }, select: { id: true, customerId: true, assignedWorkerId: true } });
      if (!job) throw new NotFoundException('Job not found');
      jobRequestId = job.id;
      targetId = user.id === job.customerId ? job.assignedWorkerId : job.customerId;
    }
    const incident = await this.prisma.incident.create({
      data: {
        reporterId: user.id, targetId, jobRequestId, type: 'SOS', kind: dto.kind, severity: 'LIFE_THREATENING',
        description: dto.note?.trim() || null, idempotencyKey: key,
      },
    });
    this.events.emit('admin.incident_reported', { incidentId: incident.id, type: 'SOS' });
    const alert = await this.alertTrustedContacts(user.id);
    await this.prisma.incident.update({ where: { id: incident.id }, data: { contactsAlertStatus: alert.status, contactsAlerted: alert.sent } });
    await this.audit.record({ actorId: user.id, action: 'safety.sos', entityType: 'Incident', entityId: incident.id, after: { kind: dto.kind, contacts: alert.status } });
    return this.result(incident.id, user.id);
  }

  /** Water, electric or gas: an urgent job, offered to the nearest free worker first. */
  private async propertyEmergency(user: { id: string; type: string }, dto: SosDto, key: string) {
    if (user.type !== 'customer') throw new ForbiddenException({ code: 'CUSTOMERS_ONLY', message: 'Use the SOS on your job screen.' });
    const address = dto.addressId
      ? await this.prisma.address.findFirst({ where: { id: dto.addressId, userId: user.id }, select: { id: true } })
      : await this.prisma.address.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], select: { id: true } });
    if (!address) throw new BadRequestException({ code: 'ADDRESS_REQUIRED', message: 'Add your address so a professional can find you.' });
    const category = await this.prisma.serviceCategory.findUnique({ where: { name: CATEGORY_FOR[dto.kind] }, select: { id: true } });
    if (!category) throw new BadRequestException({ code: 'NO_CATEGORY', message: 'This service is not available yet.' });

    const job = (await this.jobs.create(
      { id: user.id, type: 'customer' },
      {
        categoryId: category.id, addressId: address.id, when: 'NOW', isEmergency: true,
        description: [DESCRIPTION_FOR[dto.kind], dto.note?.trim()].filter(Boolean).join('. '),
        idempotencyKey: `sos-${dto.idempotencyKey}`.slice(0, 64),
      },
      { skipMatching: true },
    )) as { id: string };
    const incident = await this.prisma.incident.create({
      data: { reporterId: user.id, jobRequestId: job.id, type: 'SOS', kind: dto.kind, severity: 'PROPERTY_DAMAGE', description: DESCRIPTION_FOR[dto.kind], idempotencyKey: key },
    });
    this.events.emit('admin.incident_reported', { incidentId: incident.id, type: 'SOS' });
    await this.sos.start(job.id, incident.id);
    await this.audit.record({ actorId: user.id, action: 'safety.sos', entityType: 'Incident', entityId: incident.id, after: { kind: dto.kind, jobId: job.id } });
    return this.result(incident.id, user.id);
  }

  private async result(incidentId: string, userId: string) {
    const i = await this.prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    const { numbers } = await this.emergencyNumbers(userId);
    return {
      incidentId: i.id, kind: i.kind, jobRequestId: i.kind && PROPERTY_KINDS.includes(i.kind as SosKind) ? i.jobRequestId : null,
      emergencyNumbers: numbers,
      // Property emergencies don't alert contacts; personal ones say exactly what happened.
      contacts: i.contactsAlertStatus ? { status: i.contactsAlertStatus, alerted: i.contactsAlerted, message: CONTACT_ALERT_RESULT[i.contactsAlertStatus] } : null,
    };
  }

  /** Text each trusted contact (approximate area only). Never logs their names or numbers. */
  private async alertTrustedContacts(userId: string): Promise<{ status: string; sent: number }> {
    const [contacts, user, address] = await Promise.all([
      this.prisma.trustedContact.findMany({ where: { userId, notifyOnSos: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, locale: true } }),
      this.prisma.address.findFirst({ where: { userId }, orderBy: [{ isDefault: 'desc' }], select: { area: true, city: true } }),
    ]);
    if (!contacts.length) return { status: 'NO_CONTACTS', sent: 0 };
    if (!this.sms.configured) {
      this.logger.warn(`SOS: ${contacts.length} trusted contact(s) not alerted (no SMS provider)`);
      return { status: 'NO_PROVIDER', sent: 0 };
    }
    const text = trustedContactSms(user.locale, {
      name: user.name, time: new Date().toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' }),
      area: [address?.area, address?.city].filter(Boolean).join(', ') || null,
    });
    let sent = 0;
    for (const c of contacts) if ((await this.sms.send(c.phone, text)).ok) sent++;
    return { status: sent === contacts.length ? 'SENT' : sent ? 'PARTLY_SENT' : 'FAILED', sent };
  }

  /** Non-urgent report. Must be about your own job and the other person on it; rate-limited. */
  async reportIncident(userId: string, dto: ReportIncidentDto) {
    let targetId: string | null = null;
    if (dto.jobRequestId) {
      const job = await this.prisma.jobRequest.findFirst({ where: { id: dto.jobRequestId, OR: [{ customerId: userId }, { assignedWorkerId: userId }] }, select: { customerId: true, assignedWorkerId: true } });
      if (!job) throw new NotFoundException('Job not found');
      const other = userId === job.customerId ? job.assignedWorkerId : job.customerId;
      if (dto.targetId && dto.targetId !== other) throw new BadRequestException({ code: 'INVALID_TARGET', message: 'You can only report the other person on this job.' });
      targetId = other;
    } else if (dto.targetId) {
      throw new BadRequestException({ code: 'JOB_REQUIRED', message: 'Choose the job this is about.' });
    }
    const recent = await this.prisma.incident.count({ where: { reporterId: userId, severity: { not: 'LIFE_THREATENING' }, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= NON_URGENT_PER_HOUR) throw new HttpException({ code: 'TOO_MANY_REPORTS', message: 'You have sent several reports. Our team will contact you.' }, HttpStatus.TOO_MANY_REQUESTS);
    const incident = await this.prisma.incident.create({
      data: { reporterId: userId, targetId, jobRequestId: dto.jobRequestId ?? null, type: dto.type, severity: dto.severity, description: dto.description.trim() },
    });
    this.events.emit('admin.incident_reported', { incidentId: incident.id, type: incident.type });
    return { incidentId: incident.id };
  }

  getTrustedContacts(userId: string) {
    return this.prisma.trustedContact.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async addTrustedContact(userId: string, dto: AddTrustedContactDto) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { countryCode: true, phone: true } });
    const country = (isCountryCode(u.countryCode ?? '') ? u.countryCode : 'PK') as CountryCode;
    const parsed = parsePhone(dto.phone, country);
    if (!parsed.ok || !parsed.e164) throw new BadRequestException({ code: 'INVALID_PHONE', message: phoneErrorMessage(parsed.error!, country) });
    if (parsed.e164 === u.phone) throw new BadRequestException({ code: 'OWN_NUMBER', message: 'Add someone else\'s number.' });

    return this.prisma.$transaction(async (tx) => {
      // Lock the user row so two adds at once can't both pass the limit.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.trustedContact.findUnique({ where: { userId_phone: { userId, phone: parsed.e164! } } });
      if (!existing && (await tx.trustedContact.count({ where: { userId } })) >= MAX_CONTACTS) {
        throw new BadRequestException({ code: 'TOO_MANY_CONTACTS', message: `You can have up to ${MAX_CONTACTS} trusted contacts.` });
      }
      return tx.trustedContact.upsert({
        where: { userId_phone: { userId, phone: parsed.e164! } },
        create: { userId, name: dto.name.trim(), phone: parsed.e164!, notifyOnSos: dto.notifyOnSos ?? true },
        update: { name: dto.name.trim(), notifyOnSos: dto.notifyOnSos ?? true },
      });
    });
  }

  async removeTrustedContact(userId: string, contactId: string) {
    await this.prisma.trustedContact.deleteMany({ where: { id: contactId, userId } });
    return { success: true };
  }
}
