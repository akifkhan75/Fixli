import { RequirePermission } from '../common/auth/permissions';
import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ServiceCatalogService } from './service-catalog.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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
    @Body() body: CreateCategoryDto,
    @CurrentUser('id') staffId: string,
  ) {
    return this.catalogService.createCategory(body, staffId);
  }

  @Patch('categories/:id')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a service category (Admin)' })
  updateCategory(
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
    @CurrentUser('id') staffId: string,
  ) {
    return this.catalogService.updateCategory(id, body, staffId);
  }

  @Post('categories/:id/services')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a new service to a category (Admin)' })
  addService(
    @Param('id') categoryId: string,
    @Body() body: CreateServiceDto,
    @CurrentUser('id') staffId: string,
  ) {
    return this.catalogService.addServiceToCategory(categoryId, body, staffId);
  }

  @Patch('services/:id')
  @Roles('admin')
  @RequirePermission('catalog.edit')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a specific service (Admin)' })
  updateService(
    @Param('id') id: string,
    @Body() body: UpdateServiceDto,
    @CurrentUser('id') staffId: string,
  ) {
    return this.catalogService.updateService(id, body, staffId);
  }
}
