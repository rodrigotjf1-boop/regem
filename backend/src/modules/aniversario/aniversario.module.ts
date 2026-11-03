import { Module } from '@nestjs/common';
import { AniversarioService } from './aniversario.service';

// O aniversário do cliente e a proteção contra troca de data (Onda 3, mig 357 — só NUVEM). Módulo sem dependência dos
// outros (só o banco e a auditoria, que é global): o cliente (Perfil e Delivery › Clientes), o cardápio (o cupom), o
// robô e as automáticas importam este — e nenhum ciclo.
@Module({
  providers: [AniversarioService],
  exports: [AniversarioService],
})
export class AniversarioModule {}
