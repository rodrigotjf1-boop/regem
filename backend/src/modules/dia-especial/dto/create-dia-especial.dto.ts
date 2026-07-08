import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateDiaEspecialDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'data deve ser YYYY-MM-DD' })
  data!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dataFim deve ser YYYY-MM-DD' })
  dataFim?: string;

  @IsOptional()
  @IsIn(['feriado', 'ferias', 'evento', 'folga', 'outro'])
  tipo?: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsUUID()
  colaboradorId?: string;
}
