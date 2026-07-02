import { Module } from '@nestjs/common';
import { FichasController } from './fichas.controller';
import { FichasService } from './fichas.service';

@Module({
  controllers: [FichasController],
  providers: [FichasService],
})
export class FichasModule {}
