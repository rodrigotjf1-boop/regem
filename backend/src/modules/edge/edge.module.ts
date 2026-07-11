import { Module } from '@nestjs/common';
import { EdgeService } from './edge.service';
import { EdgeController } from './edge.controller';

// Servidor local (edge): descoberta na LAN (mDNS) + rota /ping de identificação.
@Module({
  controllers: [EdgeController],
  providers: [EdgeService],
  exports: [EdgeService],
})
export class EdgeModule {}
