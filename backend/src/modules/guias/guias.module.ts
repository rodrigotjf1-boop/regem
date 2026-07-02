import { Module } from '@nestjs/common';
import { GuiasController } from './guias.controller';
import { GuiasService } from './guias.service';

@Module({
  controllers: [GuiasController],
  providers: [GuiasService],
})
export class GuiasModule {}
