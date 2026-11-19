import { Module } from '@nestjs/common';
import { ModuloModule } from '../modulo/modulo.module';
import { CartaoDoCasoController, PerfilClienteController } from './perfil-cliente.controller';
import { PerfilClienteService } from './perfil-cliente.service';

// O perfil do cliente (F1a do docs/plano-perfil-cliente.md, mig 459). Só NUVEM (CLOUD_ONLY em app.module): o perfil é
// calculado e servido pela nuvem; a loja não tem as tabelas. O ModuloModule dá o ModuloService ao ModuloGuard (V81).
@Module({
  imports: [ModuloModule],
  controllers: [PerfilClienteController, CartaoDoCasoController],
  providers: [PerfilClienteService],
  exports: [PerfilClienteService],
})
export class PerfilClienteModule {}
