import { Module } from '@nestjs/common';
import { TarefaDefController } from './tarefa-def.controller';
import { TarefaDefService } from './tarefa-def.service';
import { TarefaInstanciaController } from './tarefa-instancia.controller';
import { TarefaInstanciaService } from './tarefa-instancia.service';
import { ModuloModule } from '../modulo/modulo.module';

@Module({
  imports: [ModuloModule], // enforcement do módulo "App do Colaborador"
  controllers: [TarefaDefController, TarefaInstanciaController],
  providers: [TarefaDefService, TarefaInstanciaService],
})
export class TarefaModule {}
