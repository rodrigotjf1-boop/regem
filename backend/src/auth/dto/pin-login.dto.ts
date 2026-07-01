import { IsUUID, Matches } from 'class-validator';

export class PinLoginDto {
  @IsUUID()
  unidadeId!: string;

  @Matches(/^\d{4,6}$/, { message: 'PIN deve ter de 4 a 6 dígitos' })
  pin!: string;
}
