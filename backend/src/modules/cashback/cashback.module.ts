import { Module } from '@nestjs/common';
import { CashbackService } from './cashback.service';
import { CashbackController } from './cashback.controller';

// Cashback (concorre com Fidelidade). O motor (crédito/estorno/uso) é consumido
// pelo Cardapio (checkout) e pelo Delivery (confirmação/cancelamento).
@Module({
  controllers: [CashbackController],
  providers: [CashbackService],
  exports: [CashbackService],
})
export class CashbackModule {}
