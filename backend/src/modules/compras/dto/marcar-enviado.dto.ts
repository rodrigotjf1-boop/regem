import { IsIn } from 'class-validator';

// "Marcar como enviado": por onde a pessoa mandou o pedido ao fornecedor.
export class MarcarEnviadoDto {
  @IsIn(['whatsapp', 'email'], { message: 'canal deve ser whatsapp ou email' })
  canal!: string;
}
