import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateColaboradorDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsUUID()
  funcaoId?: string;

  @IsOptional()
  @IsIn(['clt', 'horista', 'diarista', 'pj', 'autonomo'])
  vinculo?: string;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'PIN deve ter de 4 a 6 dígitos' })
  pin?: string;
}
