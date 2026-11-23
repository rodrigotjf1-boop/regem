import { Module } from '@nestjs/common';
import { BancoRepassesController } from './banco-repasses.controller';
import { BancoRepassesService } from './banco-repasses.service';

// Financeiro › Banco e repasses (R1 da versão 8 do Mister, mig 499): só na nuvem (CLOUD_ONLY_MODULES).
@Module({
  controllers: [BancoRepassesController],
  providers: [BancoRepassesService],
})
export class BancoRepassesModule {}
