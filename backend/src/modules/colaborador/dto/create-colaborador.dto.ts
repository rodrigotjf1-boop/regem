import {
  ArrayUnique,
  IsArray,
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
  @IsString()
  fotoRef?: string;

  // Função principal (compat). Se vazia, assume a 1ª de funcaoIds.
  @IsOptional()
  @IsUUID()
  funcaoId?: string;

  // Funções que o colaborador cobre (N:N). Uma ou mais.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  funcaoIds?: string[];

  @IsOptional()
  @IsIn(['clt', 'horista', 'diarista', 'pj', 'autonomo'])
  vinculo?: string;

  @IsOptional()
  @IsIn(['5x2', '12x36', '4x3', 'horista', 'outro'])
  jornadaTipo?: string;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'PIN deve ter de 4 a 6 dígitos' })
  pin?: string;
}
