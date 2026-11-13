import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { COUNTRIES, isCountryCode } from '@fixli/shared';
import { PrismaService } from '../database/prisma.service';
import { ReportIncidentDto, AddTrustedContactDto, SosKind } from './dto/safety.dto';
import { JobsService } from '../jobs/jobs.service';
import { DomainEvents } from '../common/events/domain-events';
import { AuditService } from '../common/audit/audit.service';
import { SMS_PROVIDER, SmsProvider } from './sms.provider';

/** Which trade answers each hazard (catalog `name` keys). Gas leaks go to plumbers/gas fitters; ops may refine. */
export const SOS_CATEGORY: Record<SosKind, string> = { WATER: 'PLUMBING', ELECTRICAL: 'ELECTRICAL', GAS: 'PLUMBING' };
const SOS_TEXT: Record<SosKind, string> = {
  WATER: 'EMERGENCY: burst pipe or major water leak.',
  ELECTRICAL: 'EMERGENCY: electrical hazard (sparks, burning smell or exposed wires).',
  GAS: 'EMERGENCY: gas smell. Customer has been told to leave the building and not use switches.',
};

/** What we say, always: Fixli coordinates help, it does not replace emergency services. */
export const SOS_DISCLAIMER =
  'Fixli SOS is an emergency coordination tool. It does NOT replace government emergency services. In danger to life, call the emergency numbers directly.';

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** Numbers come from the shared country config for the user's country (default PK). */
  async getEmergencyNumbers(userId?: string) {
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { countryCode: true } }) : null;
    const code = (user?.countryCode ?? 'PK').toUpperCase();
    const country = COUNTRIES[isCountryCode(code) ? code : 'PK'];
    return { country: country.code, numbers: country.emergencyNumbers, disclaimer: SOS_DISCLAIMER };
  }

  async reportIncident(userId: string, userType: string, dto: ReportIncidentDto) {
    // A retried SOS (flaky network) must not create a second incident or a second dispatch.
    if (dto.idempotencyKey) {
      const prior = await this.prisma.incident.findUnique({
        where: { reporterId_idempotencyKey: { reporterId: userId, idempotencyKey: dto.idempotencyKey } },
      });
      if (prior) return this.respond(userId, prior, { jobId: prior.jobRequestId ?? undefined, replay: true });
    }

    const property = dto.severity === 'PROPERTY_DAMAGE' && userType === 'customer';
    if (property && (!dto.sosKind || !dto.addressId || !dto.idempotencyKey)) {
      throw new BadRequestException({
        code: 'SOS_DETAILS_REQUIRED',
        message: 'Tell us what is wrong and where you are so we can send someone.',
      });
    }

    let incident;
    try {
      incident = await this.prisma.incident.create({
        data: {
          reporterId: userId,
          targetId: dto.targetId,
          jobRequestId: dto.jobRequestId,
          type: dto.type,
          severity: dto.severity,
          description: dto.description,
          latitude: dto.latitude,
          longitude: dto.longitude,
          idempotencyKey: dto.idempotencyKey,
          status: 'OPEN',
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && dto.idempotencyKey) {
        const prior = await this.prisma.incident.findUniqueOrThrow({
          where: { reporterId_idempotencyKey: { reporterId: userId, idempotencyKey: dto.idempotencyKey } },
        });
        return this.respond(userId, prior, { jobId: prior.jobRequestId ?? undefined, replay: true });
      }
      throw e;
    }

    await this.audit.record({
      actorId: userId, action: 'safety.incident_reported', entityType: 'Incident', entityId: incident.id,
      after: { type: dto.type, severity: dto.severity },
    });
    this.events.emit('admin.incident_reported', { incidentId: incident.id, type: incident.type });

    let jobId: string | undefined;
    let trusted = { total: 0, notified: 0 };

    if (dto.severity === 'LIFE_THREATENING') {
      // Life first: never dispatch a worker. The app shows the emergency numbers; we alert trusted contacts.
      this.logger.warn(`Life-threatening SOS ${incident.id}`);
      trusted = await this.notifyTrustedContacts(userId, incident.id, dto.latitude, dto.longitude);
    } else if (property) {
      jobId = await this.dispatchEmergencyJob(userId, dto);
      await this.prisma.incident.update({ where: { id: incident.id }, data: { jobRequestId: jobId } });
      incident = { ...incident, jobRequestId: jobId };
      trusted = await this.notifyTrustedContacts(userId, incident.id, dto.latitude, dto.longitude);
    }
    return this.respond(userId, incident, { jobId, trusted });
  }

  /** Creates the urgent job through the normal job path; matching then notifies the nearest worker first. */
  private async dispatchEmergencyJob(userId: string, dto: ReportIncidentDto): Promise<string> {
    const kind = dto.sosKind!;
    const category = await this.prisma.serviceCategory.findFirst({ where: { name: SOS_CATEGORY[kind], isActive: true }, select: { id: true } });
    if (!category) throw new BadRequestException({ code: 'SOS_UNAVAILABLE', message: 'We could not find a professional trade for this emergency. Please call emergency services.' });
    const job: any = await this.jobsService.create(
      { id: userId, type: 'customer' } as any,
      {
        categoryId: category.id,
        addressId: dto.addressId!,
        when: 'NOW',
        isEmergency: true,
        description: [SOS_TEXT[kind], dto.description?.trim()].filter(Boolean).join('\n'),
        idempotencyKey: `sos:${dto.idempotencyKey}`,
      } as any,
    );
    return job.id;
  }

  private async respond(
    userId: string,
    incident: { id: string; severity: string; jobRequestId?: string | null; [k: string]: unknown },
    extra: { jobId?: string; trusted?: { total: number; notified: number }; replay?: boolean },
  ) {
    const numbers = await this.getEmergencyNumbers(userId);
    return {
      incident,
      jobId: extra.jobId ?? null,
      replay: !!extra.replay,
      emergencyNumbers: numbers.numbers,
      country: numbers.country,
      trustedContacts: { ...(extra.trusted ?? { total: 0, notified: 0 }), smsConfigured: this.sms.configured },
      disclaimer: SOS_DISCLAIMER,
    };
  }

  private async notifyTrustedContacts(userId: string, incidentId: string, lat?: number, lng?: number) {
    const [contacts, user] = await Promise.all([
      this.prisma.trustedContact.findMany({ where: { userId, notifyOnSos: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);
    const where = lat != null && lng != null ? ` Location: https://maps.google.com/?q=${lat},${lng}` : '';
    const text = `Fixli SOS: ${user?.name ?? 'Someone you know'} pressed the emergency button and may need help.${where} Please try to reach them. Fixli has not contacted the authorities.`;
    let notified = 0;
    for (const c of contacts) {
      try {
        const r = await this.sms.send(c.phone, text);
        if (r.delivered) notified++;
      } catch (e) {
        this.logger.error(`SOS SMS failed for incident ${incidentId}: ${(e as Error).message}`);
      }
    }
    return { total: contacts.length, notified };
  }

  async getTrustedContacts(userId: string) {
    return this.prisma.trustedContact.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async addTrustedContact(userId: string, dto: AddTrustedContactDto) {
    const exists = await this.prisma.trustedContact.findUnique({ where: { userId_phone: { userId, phone: dto.phone } } });
    if (!exists && (await this.prisma.trustedContact.count({ where: { userId } })) >= 5) {
      throw new BadRequestException({ code: 'TOO_MANY_CONTACTS', message: 'You can only have up to 5 trusted contacts.' });
    }
    return this.prisma.trustedContact.upsert({
      where: { userId_phone: { userId, phone: dto.phone } },
      create: { userId, name: dto.name, phone: dto.phone, notifyOnSos: dto.notifyOnSos ?? true },
      update: { name: dto.name, notifyOnSos: dto.notifyOnSos ?? true },
    });
  }

  async removeTrustedContact(userId: string, contactId: string) {
    await this.prisma.trustedContact.deleteMany({ where: { id: contactId, userId } });
    return { success: true };
  }
}
