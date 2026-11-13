import { Module } from '@nestjs/common';
import { RelatoriosController } from './relatorios.controller';
import { RelatoriosService } from './relatorios.service';
import { ProdutoModule } from '../produto/produto.module';

@Module({
  imports: [ProdutoModule],
  controllers: [RelatoriosController],
  providers: [RelatoriosService],
  exports: [RelatoriosService], // as ferramentas de leitura do Mister usam os mesmos números da tela
})
export class RelatoriosModule {}
