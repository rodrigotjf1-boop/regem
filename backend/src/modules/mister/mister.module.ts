import { Module } from '@nestjs/common';
import { IaModule } from '../ia/ia.module';
import { ModuloModule } from '../modulo/modulo.module';
import { MisterConsoleService } from './mister-console.service';
import { MisterController } from './mister.controller';
import { MisterEntradaService } from './mister-entrada.service';
import { MisterNumeroService } from './mister-numero.service';
import { MisterVinculoService } from './mister-vinculo.service';

// MISTER (mig 417; `docs/plano-mister.md`): o número de WhatsApp da distribuição e a entrada das mensagens.
//  • Não importa o módulo do WhatsApp das lojas: o Mister fala com a Meta por conta própria (o mesmo acesso da
//    distribuição). É o módulo do WhatsApp que importa este, para entregar aqui a mensagem que chega ao número do Mister.
//  • `ModuloModule`: a régua do módulo "mister" ligado, na rota (guarda) e em cada mensagem que chega.
//  • `IaModule`: o painel do console mostra de onde vem a IA de cada empresa e o uso em 30 dias.
// Sobe junto do módulo do WhatsApp — que também sobe no servidor da loja —, mas lá não faz nada: as rotas são
// `@CloudOnly`, a rotina de limpeza só roda na nuvem e, sem a tabela, o número lê como "não conectado".
@Module({
  imports: [ModuloModule, IaModule],
  controllers: [MisterController],
  providers: [MisterNumeroService, MisterVinculoService, MisterEntradaService, MisterConsoleService],
  exports: [MisterEntradaService, MisterConsoleService, MisterNumeroService],
})
export class MisterModule {}
