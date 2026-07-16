import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const HORA = /^\d{2}:\d{2}(:\d{2})?$/;

// Geração recorrente da escala: cria a regra e preenche o período.
export class GerarEscalaDto {
  @IsUUID()
  colaboradorId!: string;

  @IsUUID()
  etiquetaId!: string;

  @IsString()
  jornadaTipo!: string; // 5x2 | 6x1 | 12x36 | 4x3 | horista | outro

  @Matches(HORA)
  horaInicio!: string;

  @Matches(HORA)
  horaFim!: string;

  @IsOptional()
  @Matches(HORA)
  pausaInicio?: string | null;

  @IsOptional()
  @Matches(HORA)
  pausaFim?: string | null;

  // Dias da semana de folga (0=domingo..6=sábado) — só tipos por dia da semana.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  folgasSemana?: number[];

  @IsDateString()
  dataInicio!: string;

  @IsDateString()
  dataFim!: string;

  @IsOptional()
  @IsBoolean()
  feriadosFechar?: boolean;

  // "Levar em conta regras da CLT vigente" (padrão ligado) — controla os avisos.
  @IsOptional()
  @IsBoolean()
  respeitarClt?: boolean;
}
