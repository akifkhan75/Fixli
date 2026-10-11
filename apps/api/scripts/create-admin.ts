/**
 * Create (or re-role) a staff account from the command line. The only way to make the first
 * Super Admin; after that, roles are managed in the admin portal (Staff).
 *
 *   pnpm --filter @fixli/api admin:create --email ops@fixli.pk --name "Ops Lead" --roles "Super Admin"
 *
 * Prints a generated password (share it privately; they should change it; the admin portal has no change-password page yet, F6). At
 * first sign-in they must set up an authenticator app.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ADMIN_ROLES, isAdminRole } from '../src/common/auth/permissions';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim() || 'Fixli staff';
  const roles = (arg('roles') ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('--email is required');
  const bad = roles.filter((r) => !isAdminRole(r));
  if (!roles.length || bad.length) throw new Error(`--roles must be a comma-separated list of: ${ADMIN_ROLES.join(', ')}`);

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.type !== 'admin') throw new Error('That email belongs to a customer or worker account.');
    const password = randomBytes(12).toString('base64url');
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { adminRoles: roles } })
      : await prisma.user.create({ data: { email, name, type: 'admin', adminRoles: roles, password: await bcrypt.hash(password, 12) } });
    await prisma.auditLog.create({ data: { action: existing ? 'staff.roles_changed' : 'staff.created', entityType: 'User', entityId: user.id, after: { roles, via: 'cli' } } });
    console.log(existing ? `Updated ${email}: roles = ${roles.join(', ')}` : `Created ${email} (${roles.join(', ')}). One-time password: ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
