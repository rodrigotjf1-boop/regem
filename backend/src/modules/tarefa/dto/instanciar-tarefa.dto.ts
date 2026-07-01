import { IsDateString, IsUUID } from 'class-validator';

export class InstanciarTarefaDto {
  @IsUUID()
  tarefaDefId!: string;

  @IsDateString()
  data!: string;
}
