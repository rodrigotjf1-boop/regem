import { Module } from '@nestjs/common';
import { PontoController } from './ponto.controller';
import { PontoService } from './ponto.service';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ModuloModule } from '../modulo/modulo.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [EquipamentoModule, ModuloModule, WhatsappModule],
  controllers: [PontoController],
  providers: [PontoService],
  exports: [PontoService],
})
export class PontoModule {}
