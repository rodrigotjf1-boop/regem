import { Module } from '@nestjs/common';
import { PontoController } from './ponto.controller';
import { PontoService } from './ponto.service';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ModuloModule } from '../modulo/modulo.module';

@Module({
  imports: [EquipamentoModule, ModuloModule],
  controllers: [PontoController],
  providers: [PontoService],
  exports: [PontoService],
})
export class PontoModule {}
