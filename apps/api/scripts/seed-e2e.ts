/**
 * Accounts for the end-to-end flows (Maestro on a phone emulator, Playwright on the admin portal).
 * Safe to run again: it resets what the flows leave behind. NEVER run this against production.
 *
 *   pnpm --filter @fixli/api db:seed:catalog && pnpm --filter @fixli/api seed:e2e
 *
 * Start the API with ADMIN_TOTP_REQUIRED=false for the admin sign-in used by Playwright.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const E2E = {
  password: 'Maestro-pass-42',
  customer: { phone: '+923009990001', national: '3009990001', name: 'Maestro Customer' },
  worker: { phone: '+923009990002', national: '3009990002', name: 'Maestro Worker' },
  worker2: { phone: '+923009990003', national: '3009990003', name: 'Maestro Worker Two' },
  pending: { phone: '+923009990004', national: '3009990004', name: 'Pending Pro Pending' },
  admin: { email: 'maestro-admin@fixli.test', name: 'E2E Admin' },
};

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed test accounts in production.');
  const prisma = new PrismaClient();
  try {
    const plumbing = await prisma.serviceCategory.findUnique({ where: { name: 'PLUMBING' } });
    if (!plumbing) throw new Error('Run the catalogue seed first: pnpm --filter @fixli/api db:seed:catalog');
    const password = await bcrypt.hash(E2E.password, 10);

    const user = async (a: { phone: string; name: string }, type: 'customer' | 'worker') =>
      prisma.user.upsert({
        where: { phone: a.phone },
        update: { password, status: 'ACTIVE', failedLoginAttempts: 0, lockoutUntil: null },
        create: { phone: a.phone, name: a.name, type, countryCode: 'PK', password },
      });

    const customer = await user(E2E.customer, 'customer');
    // Start clean: no leftover requests, chats or money from the last run.
    const mine = { jobRequest: { customerId: customer.id } };
    const jobIds = (await prisma.jobRequest.findMany({ where: { customerId: customer.id }, select: { id: true } })).map((j) => j.id);
    await prisma.conversation.deleteMany({ where: mine });
    await prisma.dispute.deleteMany({ where: { jobRequestId: { in: jobIds } } });
    await prisma.review.deleteMany({ where: { jobRequestId: { in: jobIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { jobRequestId: { in: jobIds } } });
    await prisma.payment.deleteMany({ where: mine });
    await prisma.incident.deleteMany({ where: { jobRequestId: { in: jobIds } } });
    await prisma.jobRequest.deleteMany({ where: { customerId: customer.id } });
    await prisma.address.deleteMany({ where: { userId: customer.id } });
    await prisma.address.create({ data: { userId: customer.id, label: 'Home', streetAddress: 'House 12, Street 4', area: 'Gulshan-e-Iqbal', city: 'Karachi', country: 'PK', latitude: 24.92, longitude: 67.09, isDefault: true } });

    for (const w of [E2E.worker, E2E.worker2]) {
      const u = await user(w, 'worker');
      await prisma.ledgerEntry.deleteMany({ where: { workerId: u.id } });
      await prisma.worker.upsert({
        where: { id: u.id },
        update: { activationStatus: 'ACTIVE', isVerified: true, isOnline: false, balanceBlocked: false, ledgerBalance: 0, owedSince: null },
        create: {
          id: u.id, activationStatus: 'ACTIVE', isVerified: true, isOnline: false, serviceRadius: 15, serviceLat: 24.925, serviceLng: 67.095, serviceAreaLabel: 'Karachi',
          services: { create: [{ categoryId: plumbing.id }] },
          workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) },
        },
      });
      await prisma.offer.deleteMany({ where: { workerId: u.id } });
    }

    // For the admin portal test: a professional waiting for document approval, and an open dispute.
    const pending = await user(E2E.pending, 'worker');
    await prisma.verificationCase.deleteMany({ where: { workerId: pending.id } });
    await prisma.worker.upsert({
      where: { id: pending.id },
      update: { activationStatus: 'PENDING_REVIEW', isVerified: false, isOnline: false },
      create: { id: pending.id, activationStatus: 'PENDING_REVIEW', isVerified: false, isOnline: false, services: { create: [{ categoryId: plumbing.id }] } },
    });
    await prisma.verificationCase.createMany({ data: [{ workerId: pending.id, type: 'ID', status: 'SUBMITTED', documentKeys: [], reference: '4210112345671' }, { workerId: pending.id, type: 'SELFIE', status: 'SUBMITTED', documentKeys: [] }] });

    const worker = await prisma.user.findUniqueOrThrow({ where: { phone: E2E.worker.phone } });
    const finished = await prisma.jobRequest.create({
      data: { customerId: customer.id, customerName: E2E.customer.name, title: 'Leaking tap (finished)', description: 'e2e', status: 'COMPLETED', assignedWorkerId: worker.id, categoryId: plumbing.id, latitude: 24.92, longitude: 67.09, agreedAmount: 150_000, agreedCurrency: 'PKR', bookedAt: new Date() },
    });
    await prisma.dispute.create({ data: { jobRequestId: finished.id, raisedById: customer.id, category: 'WORK_QUALITY', reason: 'Left a mess after the repair', description: 'Water on the floor', evidenceKeys: [] } });

    await prisma.user.upsert({
      where: { email: E2E.admin.email },
      update: { password, adminRoles: ['Super Admin'], status: 'ACTIVE', failedLoginAttempts: 0, lockoutUntil: null },
      create: { email: E2E.admin.email, name: E2E.admin.name, type: 'admin', countryCode: 'PK', password, adminRoles: ['Super Admin'] },
    });
    console.log('E2E accounts ready:', JSON.stringify({ customer: E2E.customer.phone, worker: E2E.worker.phone, worker2: E2E.worker2.phone, admin: E2E.admin.email, password: E2E.password }));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
