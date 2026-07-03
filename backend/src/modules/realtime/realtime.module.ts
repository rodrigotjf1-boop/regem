import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { RealtimeGateway } from './realtime.gateway';

// JwtModule é global (AuthModule @Global), então JwtService é injetável aqui.
@Module({
  imports: [EquipamentoModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
