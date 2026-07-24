import { Module } from '@nestjs/common';
import { EmpresaController } from './empresa.controller';
import { WorkspaceController } from './workspace.controller';
import { EmpresaService } from './empresa.service';

@Module({
  // WorkspaceController é público (passo anterior ao login) — ver o arquivo.
  controllers: [EmpresaController, WorkspaceController],
  providers: [EmpresaService],
})
export class EmpresaModule {}
