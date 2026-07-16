import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateJanelaPicoDto {
  @IsUUID()
  unidadeId!: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  // 0=domingo .. 6=sábado; ausente = todos os dias.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana?: number;

  // Fim do intervalo (inclusive) quando é uma faixa de dias (ex.: seg→sex).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemanaFim?: number;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'horaInicio inválida (HH:MM)' })
  horaInicio!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'horaFim inválida (HH:MM)' })
  horaFim!: string;
}
