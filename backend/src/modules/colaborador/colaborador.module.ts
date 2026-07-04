import { Module } from '@nestjs/common';
import { ColaboradorController } from './colaborador.controller';
import { ColaboradorService } from './colaborador.service';
import { PrefsController } from './prefs.controller';
import { PrefsService } from './prefs.service';

@Module({
  controllers: [ColaboradorController, PrefsController],
  providers: [ColaboradorService, PrefsService],
})
export class ColaboradorModule {}
