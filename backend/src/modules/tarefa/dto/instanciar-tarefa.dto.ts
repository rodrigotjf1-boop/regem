import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class InstanciarTarefaDto {
  @IsUUID()
  tarefaDefId!: string;

  @IsDateString()
  data!: string;

  // Responsável escolhido por quem cria: um escalado da função/setor, ou ausente
  // = "em aberto" (qualquer um da função executa).
  @IsOptional()
  @IsUUID()
  colaboradorResolvidoId?: string;
}
