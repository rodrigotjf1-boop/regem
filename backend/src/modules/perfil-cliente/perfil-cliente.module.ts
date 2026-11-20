import { Module } from '@nestjs/common';
import { ModuloModule } from '../modulo/modulo.module';
import { CartaoDoCasoController, PerfilClienteController } from './perfil-cliente.controller';
import { PerfilClienteService } from './perfil-cliente.service';
import { CalendarioDaLojaController } from './calendario-da-loja.controller';
import { CalendarioDaLojaService } from './calendario-da-loja.service';

// O perfil do cliente (F1a do docs/plano-perfil-cliente.md, mig 459) e o calendário da loja (F2, mig 461). Só NUVEM
// (CLOUD_ONLY em app.module): o perfil é calculado e servido pela nuvem; a loja não tem as tabelas. O ModuloModule dá o
// ModuloService ao ModuloGuard (V81).
@Module({
  imports: [ModuloModule],
  controllers: [PerfilClienteController, CartaoDoCasoController, CalendarioDaLojaController],
  providers: [PerfilClienteService, CalendarioDaLojaService],
  exports: [PerfilClienteService],
})
export class PerfilClienteModule {}
