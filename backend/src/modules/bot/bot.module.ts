import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { ModuloModule } from '../modulo/modulo.module';

@Module({
  imports: [ModuloModule],
  controllers: [BotController],
  providers: [BotService],
})
export class BotModule {}
