import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, CreateAssetDto, CreateWarrantyDto } from './dto/property.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '../common/features/feature.guard';

@ApiTags('properties')
@ApiBearerAuth()
@Roles('customer')
@RequiresFeature('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a property' })
  createProperty(@CurrentUser('id') userId: string, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.createProperty(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Your properties' })
  getProperties(@CurrentUser('id') userId: string) {
    return this.propertiesService.getUserProperties(userId);
  }

  @Post(':id/assets')
  @ApiOperation({ summary: 'Add an asset to one of your properties' })
  addAsset(@Param('id') propertyId: string, @CurrentUser('id') userId: string, @Body() dto: CreateAssetDto) {
    return this.propertiesService.addAsset(userId, propertyId, dto);
  }

  @Post('assets/:assetId/warranties')
  @ApiOperation({ summary: 'Add a warranty to one of your assets' })
  addWarranty(@Param('assetId') assetId: string, @CurrentUser('id') userId: string, @Body() dto: CreateWarrantyDto) {
    return this.propertiesService.addWarranty(userId, assetId, dto);
  }
}
