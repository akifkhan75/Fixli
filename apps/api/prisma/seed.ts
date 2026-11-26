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

  // Clean existing data: every table except the migration history (the catalog is re-created below).
  // Done generically so this keeps working as the schema grows (a hand-written delete list went stale).
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Real catalog (idempotent), then look up what the demo data needs.
  await seedCatalog(prisma);
  const catPlumbing = await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'PLUMBING' } });
  const catElectrical = await prisma.serviceCategory.findUniqueOrThrow({ where: { name: 'ELECTRICAL' } });

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
  console.log('Dev logins (password: password123): customer 0300 1234567 · worker 0311 2345678 · admin admin@fixli.dev');

  // Workers
  await prisma.worker.create({
    data: {
      id: 'w1', activationStatus: 'ACTIVE', isOnline: true, rating: 4.8, isVerified: true, currency: 'PKR',
      pricingModel: 'CALLOUT_PLUS_QUOTE', minimumCallOutFee: 150000, serviceLat: 24.9215, serviceLng: 67.0925,
      serviceAreaLabel: 'Gulshan-e-Iqbal, Karachi', serviceRadius: 25, bio: 'Dev demo plumber and electrician.',
      services: {
        create: [
          { categoryId: catPlumbing.id },
          { categoryId: catElectrical.id }
        ]
      },
      // Open every day, all day, so the demo worker is matchable whenever you test.
      workingHours: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) },
    },
  });
  await prisma.address.create({
    data: { userId: 'cust1', label: 'Home', streetAddress: 'House 12, Street 4', city: 'Karachi', area: 'Gulshan-e-Iqbal', country: 'PK', latitude: 24.9215, longitude: 67.0925, isDefault: true },
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
