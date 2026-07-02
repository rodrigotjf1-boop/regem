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
import { GuiasService } from './guias.service';
import { CreateGuiaDto } from './dto/create-guia.dto';
import { UpdateGuiaDto } from './dto/update-guia.dto';
import { CreatePassoDto } from './dto/create-passo.dto';

@Controller('guias')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuiasController {
  constructor(private readonly service: GuiasService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.tenantId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user.tenantId, id);
  }

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGuiaDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateGuiaDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(':id/passos')
  @Roles('presidente', 'gerente', 'supervisao')
  addPasso(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePassoDto,
  ) {
    return this.service.addPasso(user.tenantId, id, dto);
  }

  @Delete('passos/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  removePasso(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removePasso(user.tenantId, id);
  }
}
