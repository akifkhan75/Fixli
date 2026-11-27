import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

const MAX_ADDRESSES = 10;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertCoords(d: { latitude?: number; longitude?: number }, required: boolean) {
    if (required && (d.latitude == null || d.longitude == null)) {
      throw new BadRequestException({ code: 'LOCATION_REQUIRED', message: 'Turn on location or pin this address on the map so we can find nearby professionals.' });
    }
    if ((d.latitude == null) !== (d.longitude == null)) {
      throw new BadRequestException({ code: 'INVALID_COORDINATES', message: 'Send both latitude and longitude, or neither.' });
    }
  }

  async create(userId: string, data: CreateAddressDto) {
    this.assertCoords(data, true);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new ConflictException({ code: 'ADDRESS_LIMIT', message: `You can save up to ${MAX_ADDRESSES} addresses.` });
      }
      // The first address is always the default.
      const makeDefault = data.isDefault === true || count === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...data, country: data.country.toUpperCase(), userId, isDefault: makeDefault } });
    });
  }

  findAll(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      take: MAX_ADDRESSES,
    });
  }

  async update(id: string, userId: string, data: UpdateAddressDto) {
    this.assertCoords(data, false);
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.address.findFirst({ where: { id, userId } });
      if (!address) throw new NotFoundException('Address not found');
      if (data.isDefault) await tx.address.updateMany({ where: { userId, id: { not: id } }, data: { isDefault: false } });
      // Cannot "un-default" the only default; set another one as default instead.
      const { isDefault, ...rest } = data;
      return tx.address.update({
        where: { id },
        data: { ...rest, country: rest.country?.toUpperCase(), ...(isDefault === true ? { isDefault: true } : {}) },
      });
    });
  }

  async remove(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.address.findFirst({ where: { id, userId } });
      if (!address) throw new NotFoundException('Address not found');
      await tx.address.delete({ where: { id } });
      if (address.isDefault) {
        const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      return { success: true };
    });
  }
}
