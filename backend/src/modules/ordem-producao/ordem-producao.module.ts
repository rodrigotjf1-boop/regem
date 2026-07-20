import { Module } from '@nestjs/common';
import { OrdemProducaoController } from './ordem-producao.controller';
import { OrdemProducaoService } from './ordem-producao.service';
import { ProducaoModule } from '../producao/producao.module';
import { AuditoriaModule } from '../auditoria/auditoria.module';

@Module({
  imports: [ProducaoModule, AuditoriaModule],
  controllers: [OrdemProducaoController],
  providers: [OrdemProducaoService],
  exports: [OrdemProducaoService], // job diário D+1 (JobsService)
})
export class OrdemProducaoModule {}
