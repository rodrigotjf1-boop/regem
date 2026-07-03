import { Module } from '@nestjs/common';
import { MidiaModule } from '../midia/midia.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [MidiaModule],
  providers: [JobsService],
})
export class JobsModule {}
