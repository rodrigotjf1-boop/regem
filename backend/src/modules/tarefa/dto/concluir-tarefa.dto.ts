import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ConcluirTarefaDto {
  @IsIn(['em_execucao', 'feita', 'parcial', 'nao_feita', 'impossibilitada'])
  estado!: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;

  @IsOptional()
  @IsBoolean()
  conclusaoEmMassa?: boolean;
}
