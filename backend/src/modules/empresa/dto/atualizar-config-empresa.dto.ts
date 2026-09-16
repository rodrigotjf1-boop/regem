import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

// Config da empresa editável pelo presidente no Financeiro. Cada campo é independente:
// salvar um não mexe no outro.
export class AtualizarConfigEmpresaDto {
  // Janela (dias) que o servidor local puxa das transacionais pesadas da nuvem.
  // Faixa sã: de 1 semana a ~10 anos. A nuvem guarda tudo; isto só limita o edge.
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  mirrorDias?: number;

  // Hora (HH:MM, fuso SP) em que o dia é considerado fechado para o snapshot do CMV.
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'snapshotHora deve ser HH:MM' })
  snapshotHora?: string;
}
