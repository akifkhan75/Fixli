import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedCatalog } from './seed-catalog';

const prisma = new PrismaClient();

async function main() {
  // Dev-only demo data with a known password. It also wipes tables, so it must never run in production.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the demo seed with NODE_ENV=production');
  }
  console.log('🌱 Seeding DEV database (demo accounts, password: password123)...');

  // Clean existing data
  await prisma.chatMessage.deleteMany();
  await prisma.chatThread.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.jobEvidence.deleteMany();
  await prisma.changeOrder.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.jobRequest.deleteMany();
  await prisma.servicePackage.deleteMany();
  await prisma.subscriptionPlan.deleteMany();
  await prisma.workerService.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.address.deleteMany();
  await prisma.review.deleteMany();
  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Real catalog (idempotent), then look up what the demo data needs.
  await seedCatalog(prisma);
  const catPlumbing = await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } });
  const catElectrical = await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'ELECTRICAL' } });
  const svcLeak = await prisma.service.findFirstOrThrow({ where: { categoryId: catPlumbing.id } });

  // Users
  const cust1 = await prisma.user.create({
    data: { id: 'cust1', name: 'Alice Customer', phone: '+923001234567', countryCode: 'PK', locale: 'en', password: hashedPassword, type: 'customer' },
  });

  const worker1 = await prisma.user.create({
    data: { id: 'w1', name: 'Bob Worker', phone: '+923112345678', countryCode: 'PK', locale: 'en', password: hashedPassword, type: 'worker' },
  });

  await prisma.user.create({
    data: { id: 'admin1', name: 'Dev Admin', email: 'admin@fixli.dev', password: hashedPassword, type: 'admin', adminRoles: ['Super Admin'] },
  });
  console.log('Dev logins (password: password123): customer 0300 1234567 · worker 0311 2345678 · admin admin@fixli.dev (sets up an authenticator at first sign-in)');

  // Workers
  await prisma.worker.create({
    data: {
      id: 'w1', activationStatus: 'ACTIVE', rating: 4.8, isVerified: true, currency: 'PKR',
      pricingModel: 'CALLOUT_PLUS_QUOTE', minimumCallOutFee: 150000, serviceLat: 24.8607, serviceLng: 67.0011,
      serviceAreaLabel: 'Karachi', serviceRadius: 10, bio: 'Dev demo plumber and electrician.',
      services: {
        create: [
          { categoryId: catPlumbing.id },
          { categoryId: catElectrical.id }
        ]
      }
    },
  });

  // Jobs
  await prisma.jobRequest.create({
    data: {
      id: 'jr1', customerId: 'cust1', customerName: 'Alice Customer',
      description: 'My kitchen faucet is leaking constantly.',
      serviceId: svcLeak.id, urgency: 'High', severity: 'Major',
      estimatedDuration: '1-2 hours', priceEstimate: 'Moderate',
      status: 'MATCHES_FOUND', location: 'New York, NY'
    },
  });

  console.log('✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
