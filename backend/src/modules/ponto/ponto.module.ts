import { Module } from '@nestjs/common';
import { PontoController } from './ponto.controller';
import { PontoService } from './ponto.service';
import { EquipamentoModule } from '../equipamento/equipamento.module';

@Module({
  imports: [EquipamentoModule],
  controllers: [PontoController],
  providers: [PontoService],
  exports: [PontoService],
})
export class PontoModule {}
