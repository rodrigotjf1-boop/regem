import { IsInt, Max, Min } from 'class-validator';

// Config da empresa editável pelo presidente no Financeiro.
export class AtualizarConfigEmpresaDto {
  // Janela (dias) que o servidor local puxa das transacionais pesadas da nuvem.
  // Faixa sã: de 1 semana a ~10 anos. A nuvem guarda tudo; isto só limita o edge.
  @IsInt()
  @Min(7)
  @Max(3650)
  mirrorDias!: number;
}
