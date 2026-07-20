import { Module } from '@nestjs/common';
import { MidiaModule } from '../midia/midia.module';
import { EstoqueModule } from '../estoque/estoque.module';
import { OrdemProducaoModule } from '../ordem-producao/ordem-producao.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [MidiaModule, EstoqueModule, OrdemProducaoModule],
  providers: [JobsService],
})
export class JobsModule {}
