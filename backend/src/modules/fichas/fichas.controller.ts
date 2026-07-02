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
import { FichasService } from './fichas.service';
import { CreateFichaDto } from './dto/create-ficha.dto';
import { UpdateFichaDto } from './dto/update-ficha.dto';
import { CreateIngredienteDto } from './dto/create-ingrediente.dto';

@Controller('fichas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FichasController {
  constructor(private readonly service: FichasService) {}

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
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFichaDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFichaDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(':id/ingredientes')
  @Roles('presidente', 'gerente', 'supervisao')
  addIngrediente(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateIngredienteDto,
  ) {
    return this.service.addIngrediente(user.tenantId, id, dto);
  }

  @Delete('ingredientes/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  removeIngrediente(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeIngrediente(user.tenantId, id);
  }
}
