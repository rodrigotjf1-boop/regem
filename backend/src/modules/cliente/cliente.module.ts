import { Module } from '@nestjs/common';
import { ClientePublicoController } from './cliente.controller';
import { ClienteAdminController } from './cliente-admin.controller';
import { ClienteService } from './cliente.service';

@Module({
  controllers: [ClientePublicoController, ClienteAdminController],
  providers: [ClienteService],
})
export class ClienteModule {}
