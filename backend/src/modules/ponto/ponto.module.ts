import { Module } from '@nestjs/common';
import { PontoController } from './ponto.controller';
import { PontoService } from './ponto.service';

@Module({
  controllers: [PontoController],
  providers: [PontoService],
})
export class PontoModule {}
