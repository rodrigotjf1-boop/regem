import { Module } from '@nestjs/common';
import { MidiaModule } from '../midia/midia.module';
import { EstoqueModule } from '../estoque/estoque.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [MidiaModule, EstoqueModule],
  providers: [JobsService],
})
export class JobsModule {}
