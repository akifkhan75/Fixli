import { RequirePermission } from '../common/auth/permissions';
import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ServiceCatalogService } from './service-catalog.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateCategoryDto, UpdateCategoryDto, CreateServiceDto, UpdateServiceDto } from './dto/catalog.dto';

@ApiTags('service-catalog')
@Controller('service-catalog')
export class ServiceCatalogController {
  constructor(private readonly catalogService: ServiceCatalogService) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Get all service categories and their services' })
  getAllCategories() {
    return this.catalogService.getAllCategories(false);
  }

  @Public()
  @Get('categories/:id')
  @ApiOperation({ summary: 'Get category by ID' })
  getCategoryById(@Param('id') id: string) {
    return this.catalogService.getCategoryById(id);
  }

  @Post('categories')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new service category (Admin)' })
  createCategory(
    @Body() body: CreateCategoryDto
  ) {
    return this.catalogService.createCategory(body);
  }

  @Patch('categories/:id')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a service category (Admin)' })
  updateCategory(
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto
  ) {
    return this.catalogService.updateCategory(id, body);
  }

  @Post('categories/:id/services')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a new service to a category (Admin)' })
  addService(
    @Param('id') categoryId: string,
    @Body() body: CreateServiceDto
  ) {
    return this.catalogService.addServiceToCategory(categoryId, body);
  }

  @Patch('services/:id')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a specific service (Admin)' })
  updateService(
    @Param('id') id: string,
    @Body() body: UpdateServiceDto
  ) {
    return this.catalogService.updateService(id, body);
  }
}
