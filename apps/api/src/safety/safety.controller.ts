import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SafetyService } from './safety.service';
import { AddTrustedContactDto, ReportIncidentDto, SosDto } from './dto/safety.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('safety')
@ApiBearerAuth()
@Controller('safety')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get('emergency-numbers')
  @ApiOperation({ summary: 'Emergency numbers for my country (cache them for offline use)' })
  numbers(@CurrentUser('id') userId: string) {
    return this.safety.emergencyNumbers(userId);
  }

  @Post('sos')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'SOS. Life-threatening / in-job: numbers + safety team + trusted contacts, never a worker. Water / electric / gas: urgent job to the nearest free worker.' })
  sos(@CurrentUser() user: { id: string; type: string }, @Body() dto: SosDto) {
    return this.safety.raiseSos(user, dto);
  }

  @Post('incidents')
  @ApiOperation({ summary: 'Report a problem (not urgent)' })
  report(@CurrentUser('id') userId: string, @Body() dto: ReportIncidentDto) {
    return this.safety.reportIncident(userId, dto);
  }

  @Get('trusted-contacts')
  contacts(@CurrentUser('id') userId: string) {
    return this.safety.getTrustedContacts(userId);
  }

  @Post('trusted-contacts')
  addContact(@CurrentUser('id') userId: string, @Body() dto: AddTrustedContactDto) {
    return this.safety.addTrustedContact(userId, dto);
  }

  @Delete('trusted-contacts/:id')
  removeContact(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.safety.removeTrustedContact(userId, id);
  }
}
