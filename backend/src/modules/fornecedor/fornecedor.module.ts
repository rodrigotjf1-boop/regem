import { Module } from '@nestjs/common';
import { FornecedorController } from './fornecedor.controller';
import { FornecedorService } from './fornecedor.service';

@Module({
  controllers: [FornecedorController],
  providers: [FornecedorService],
  // Versão 9, O3: o Mister cadastra o fornecedor pelo MESMO serviço da tela.
  exports: [FornecedorService],
})
export class FornecedorModule {}
