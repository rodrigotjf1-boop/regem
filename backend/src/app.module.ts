import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from './db/drizzle.module';
import { AppController } from './app.controller';
import { EmpresaModule } from './modules/empresa/empresa.module';
import { UnidadeModule } from './modules/unidade/unidade.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    AuthModule,
    EmpresaModule,
    UnidadeModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
