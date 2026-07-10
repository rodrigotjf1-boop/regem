import { Module } from '@nestjs/common';
import { ClientePublicoController } from './cliente.controller';
import { ClienteService } from './cliente.service';

@Module({
  controllers: [ClientePublicoController],
  providers: [ClienteService],
})
export class ClienteModule {}
