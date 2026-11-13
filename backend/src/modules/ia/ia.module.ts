import { Module } from '@nestjs/common';
import { IaController } from './ia.controller';
import { IaEmpresaService } from './ia-empresa.service';

// IA POR EMPRESA (mig 415): a chave de IA do lojista e o medidor de uso — a base da F2 do plano do Mister
// (`docs/plano-mister.md`). Quem fala com um modelo de IA em nome de uma empresa passa pelo `IaEmpresaService`.
// As rotas são só da nuvem (`@CloudOnly`) e o serviço não dá acesso no servidor da loja.
@Module({
  controllers: [IaController],
  providers: [IaEmpresaService],
  exports: [IaEmpresaService],
})
export class IaModule {}
