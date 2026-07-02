import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CriarAjusteDto {
  @IsUUID()
  colaboradorId!: string;

  @IsDateString()
  data!: string; // dia a que o ajuste se refere

  @IsIn(['desconsideracao', 'abono', 'atestado', 'justificativa'])
  tipo!: string;

  // Para desconsideracao: a marcação a ignorar no espelho.
  @IsOptional()
  @IsUUID()
  marcacaoId?: string;

  // Crédito em minutos (abono/atestado). Ausente = abona a jornada esperada do dia.
  @IsOptional()
  @IsInt()
  @Min(0)
  minutos?: number;

  @IsString()
  @MinLength(3)
  justificativa!: string;

  @IsOptional()
  @IsString()
  atestadoRef?: string;
}
