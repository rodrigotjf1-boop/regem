import { Module } from '@nestjs/common';
import { ClientePublicoController } from './cliente.controller';
import { ClienteAdminController } from './cliente-admin.controller';
import { ClienteService } from './cliente.service';
import { AtendimentoModule } from '../atendimento/atendimento.module';
import { AniversarioModule } from '../aniversario/aniversario.module';

// AniversarioModule: o aniversário do Perfil, da confirmação e de Delivery › Clientes (Onda 3, mig 357).
@Module({
  imports: [AtendimentoModule, AniversarioModule],
  controllers: [ClientePublicoController, ClienteAdminController],
  providers: [ClienteService],
  exports: [ClienteService],
})
export class ClienteModule {}
