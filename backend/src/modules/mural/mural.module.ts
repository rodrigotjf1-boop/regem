import { Module } from '@nestjs/common';
import { MuralController } from './mural.controller';
import { MuralService } from './mural.service';

@Module({
  controllers: [MuralController],
  providers: [MuralService],
  // M3g parte 2: o recado que o Mister escreve sai pelo MESMO publicar da tela.
  exports: [MuralService],
})
export class MuralModule {}
