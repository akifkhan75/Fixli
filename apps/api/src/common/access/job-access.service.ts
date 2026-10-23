import { StaffAccessService } from './staff-access.service';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface JobParty {
  id: string;
  customerId: string;
  assignedWorkerId: string | null;
  status: string;
}

/** Single answer to "may this user touch this job?" so every module enforces the same rule. */
@Injectable()
export class JobAccessService {
  constructor(private readonly prisma: PrismaService, private readonly staff: StaffAccessService) {}

  /** Returns the job if the user is its customer, its assigned worker, or an admin. Else 404. */
  async requireParticipant(
    jobId: string,
    user: { id: string; type: string },
  ): Promise<JobParty> {
    const job = await this.prisma.jobRequest.findUnique({
      where: { id: jobId },
      select: { id: true, customerId: true, assignedWorkerId: true, status: true },
    });
    const allowed =
      !!job &&
      (user.type === 'admin' || job.customerId === user.id || job.assignedWorkerId === user.id);
    if (!job || !allowed) throw new NotFoundException('Job not found');
    await this.staff.assert(user, 'jobs.read', 'disputes.read', 'safety.read');
    return job;
  }

  /** Same, but only the assigned worker (not customer/admin) is accepted. */
  async requireAssignedWorker(jobId: string, workerId: string): Promise<JobParty> {
    const job = await this.requireParticipant(jobId, { id: workerId, type: 'worker' });
    if (job.assignedWorkerId !== workerId) {
      throw new ForbiddenException('You are not assigned to this job');
    }
    return job;
  }
}
