import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ReportIncidentDto, AddTrustedContactDto } from './dto/safety.dto';
import { JobsService } from '../jobs/jobs.service';
import { DomainEvents } from '../common/events/domain-events';

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsService,
    private readonly events: DomainEvents,
  ) {}

  getEmergencyNumbers(country: string = 'PK') {
    // In a real app this comes from CountryConfig. Hardcoding PK numbers for now.
    return {
      police: '15',
      ambulance: '115',
      fire: '16',
      general: '1122',
    };
  }

  async reportIncident(userId: string, userType: string, dto: ReportIncidentDto) {
    const incident = await this.prisma.incident.create({
      data: {
        reporterId: userId,
        targetId: dto.targetId,
        jobRequestId: dto.jobRequestId,
        type: dto.type,
        severity: dto.severity,
        description: dto.description,
        status: 'OPEN',
      },
    });

    this.events.emit('admin.incident_reported', {
      incidentId: incident.id,
      type: incident.type,
    });

    if (dto.severity === 'LIFE_THREATENING') {
      // Never dispatch a worker. Provide emergency numbers.
      // SMS to trusted contacts would happen here.
      this.logger.warn(`Life-threatening SOS reported by ${userId}`);
      await this.notifyTrustedContacts(userId, incident.id);
    } else if (dto.severity === 'PROPERTY_DAMAGE' && userType === 'customer') {
      // Auto-dispatch urgent job
      this.logger.log(`Property emergency reported by ${userId}. Auto-dispatching urgent job.`);
      // In a full implementation, we'd create an urgent job here.
      // e.g. this.jobsService.create(...) 
    }

    return incident;
  }

  private async notifyTrustedContacts(userId: string, incidentId: string) {
    const contacts = await this.prisma.trustedContact.findMany({
      where: { userId, notifyOnSos: true },
    });
    
    // No SMS provider yet (doc 27 F5 / D-F5): nothing is sent. Log counts only, never contacts'
    // names or numbers.
    if (contacts.length) this.logger.warn(`Incident ${incidentId}: ${contacts.length} trusted contact(s) NOT notified (no SMS provider configured)`);
  }

  async getTrustedContacts(userId: string) {
    return this.prisma.trustedContact.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addTrustedContact(userId: string, dto: AddTrustedContactDto) {
    const count = await this.prisma.trustedContact.count({ where: { userId } });
    if (count >= 5) {
      throw new BadRequestException('You can only have up to 5 trusted contacts.');
    }

    return this.prisma.trustedContact.upsert({
      where: { userId_phone: { userId, phone: dto.phone } },
      create: {
        userId,
        name: dto.name,
        phone: dto.phone,
        notifyOnSos: dto.notifyOnSos ?? true,
      },
      update: {
        name: dto.name,
        notifyOnSos: dto.notifyOnSos ?? true,
      },
    });
  }

  async removeTrustedContact(userId: string, contactId: string) {
    await this.prisma.trustedContact.deleteMany({
      where: { id: contactId, userId },
    });
    return { success: true };
  }
}
