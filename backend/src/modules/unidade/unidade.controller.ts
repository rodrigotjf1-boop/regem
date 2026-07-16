import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeService } from './unidade.service';
import { CreateUnidadeDto } from './dto/create-unidade.dto';

@Controller('unidades')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UnidadeController {
  constructor(private readonly service: UnidadeService) {}

  @Post()
  @Roles('presidente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUnidadeDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Patch(':id')
  @Roles('presidente')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateUnidadeDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
