import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '../common/features/feature.guard';

@ApiTags('services')
@Public()
@Controller()
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @RequiresFeature('service_packages')
  @Get('service-packages')
  @ApiOperation({ summary: 'Get all service packages' })
  findAllPackages() {
    return this.servicesService.findAllPackages();
  }

  @RequiresFeature('service_packages')
  @Get('service-packages/:id')
  @ApiOperation({ summary: 'Get service package by ID' })
  findPackageById(@Param('id') id: string) {
    return this.servicesService.findPackageById(id);
  }

  @RequiresFeature('subscriptions')
  @Get('subscription-plans')
  @ApiOperation({ summary: 'Get all subscription plans' })
  findAllPlans() {
    return this.servicesService.findAllPlans();
  }

  @RequiresFeature('subscriptions')
  @Get('subscription-plans/:id')
  @ApiOperation({ summary: 'Get subscription plan by ID' })
  findPlanById(@Param('id') id: string) {
    return this.servicesService.findPlanById(id);
  }
}
