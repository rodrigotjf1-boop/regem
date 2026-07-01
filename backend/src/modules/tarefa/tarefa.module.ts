import { Module } from '@nestjs/common';
import { TarefaDefController } from './tarefa-def.controller';
import { TarefaDefService } from './tarefa-def.service';
import { TarefaInstanciaController } from './tarefa-instancia.controller';
import { TarefaInstanciaService } from './tarefa-instancia.service';

@Module({
  controllers: [TarefaDefController, TarefaInstanciaController],
  providers: [TarefaDefService, TarefaInstanciaService],
})
export class TarefaModule {}
