import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { CreateCategoryDto, CreateServiceDto, UpdateCategoryDto, UpdateServiceDto } from './dto/catalog.dto';

const CATEGORY_INCLUDE = (includeInactive: boolean) => ({
  services: { where: includeInactive ? undefined : { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }] },
  issues: { where: includeInactive ? undefined : { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }] },
});

@Injectable()
export class ServiceCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  getAllCategories(includeInactive = false) {
    return this.prisma.serviceCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: CATEGORY_INCLUDE(includeInactive),
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getCategoryById(id: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id, isActive: true },
      include: CATEGORY_INCLUDE(false),
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  // Staff changes: every one audited with before and after.
  async createCategory(data: CreateCategoryDto, staffId: string) {
    const c = await this.prisma.serviceCategory.create({ data });
    await this.audit.record({ actorId: staffId, action: 'catalog.category_created', entityType: 'ServiceCategory', entityId: c.id, after: data as object });
    return c;
  }

  async updateCategory(id: string, data: UpdateCategoryDto, staffId: string) {
    const before = await this.prisma.serviceCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    const c = await this.prisma.serviceCategory.update({ where: { id }, data });
    await this.audit.record({ actorId: staffId, action: 'catalog.category_updated', entityType: 'ServiceCategory', entityId: id, before, after: data as object });
    return c;
  }

  async addServiceToCategory(categoryId: string, data: CreateServiceDto, staffId: string) {
    if (!(await this.prisma.serviceCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) throw new NotFoundException('Category not found');
    const sv = await this.prisma.service.create({ data: { ...data, categoryId } });
    await this.audit.record({ actorId: staffId, action: 'catalog.service_created', entityType: 'Service', entityId: sv.id, after: { ...data, categoryId } });
    return sv;
  }

  async updateService(serviceId: string, data: UpdateServiceDto, staffId: string) {
    const before = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!before) throw new NotFoundException('Service not found');
    const sv = await this.prisma.service.update({ where: { id: serviceId }, data });
    await this.audit.record({ actorId: staffId, action: 'catalog.service_updated', entityType: 'Service', entityId: serviceId, before, after: data as object });
    return sv;
  }
}
