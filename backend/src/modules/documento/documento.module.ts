import { Module } from '@nestjs/common';
import { DocumentoController } from './documento.controller';
import { DocumentoService } from './documento.service';

@Module({
  controllers: [DocumentoController],
  providers: [DocumentoService],
})
export class DocumentoModule {}
