import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService], // as ferramentas de leitura do Mister usam o mesmo resumo do Painel
})
export class DashboardModule {}
