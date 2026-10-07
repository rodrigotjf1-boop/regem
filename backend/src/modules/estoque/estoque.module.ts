import { Module } from '@nestjs/common';
import { EstoqueController } from './estoque.controller';
import { EstoqueService } from './estoque.service';
import { ProdutosPlanilhaService } from './produtos-planilha.service';

@Module({
  controllers: [EstoqueController],
  providers: [EstoqueService, ProdutosPlanilhaService],
  exports: [EstoqueService],
})
export class EstoqueModule {}
