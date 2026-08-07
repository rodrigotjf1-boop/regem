import { Module } from '@nestjs/common';
import { SuporteController } from './suporte.controller';
import { SuporteService } from './suporte.service';

// F9 — lado da loja do acesso de suporte (AuditoriaService é @Global).
@Module({
  controllers: [SuporteController],
  providers: [SuporteService],
})
export class SuporteModule {}
