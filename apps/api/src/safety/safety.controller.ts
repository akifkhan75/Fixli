import { Controller, Post, Body, Get, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SafetyService } from './safety.service';
import { ReportIncidentDto, AddTrustedContactDto } from './dto/safety.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('safety')
@ApiBearerAuth()
@Controller('safety')
export class SafetyController {
  constructor(private readonly safetyService: SafetyService) {}

  @Get('emergency-numbers')
  @ApiOperation({ summary: 'Get local emergency numbers (e.g. Police, Ambulance)' })
  getEmergencyNumbers(@CurrentUser('id') userId: string) {
    return this.safetyService.getEmergencyNumbers(userId);
  }

  @Post('incidents')
  @ApiOperation({ summary: 'Report an SOS or other incident' })
  reportIncident(
    @CurrentUser('id') userId: string,
    @CurrentUser('type') userType: string,
    @Body() dto: ReportIncidentDto,
  ) {
    return this.safetyService.reportIncident(userId, userType, dto);
  }

  @Get('trusted-contacts')
  @ApiOperation({ summary: 'List trusted contacts' })
  getTrustedContacts(@CurrentUser('id') userId: string) {
    return this.safetyService.getTrustedContacts(userId);
  }

  @Post('trusted-contacts')
  @ApiOperation({ summary: 'Add or update a trusted contact' })
  addTrustedContact(
    @CurrentUser('id') userId: string,
    @Body() dto: AddTrustedContactDto,
  ) {
    return this.safetyService.addTrustedContact(userId, dto);
  }

  @Delete('trusted-contacts/:id')
  @ApiOperation({ summary: 'Remove a trusted contact' })
  removeTrustedContact(
    @CurrentUser('id') userId: string,
    @Param('id') contactId: string,
  ) {
    return this.safetyService.removeTrustedContact(userId, contactId);
  }
}
