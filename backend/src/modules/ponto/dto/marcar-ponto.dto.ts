import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class MarcarPontoDto {
  @IsIn(['entrada', 'saida', 'intervalo_inicio', 'intervalo_fim'])
  tipo!: string;

  @IsOptional()
  @IsIn(['web', 'terminal', 'app'])
  origem?: string;

  // Para terminal/gestor marcar por outro colaborador; ausente = o próprio.
  @IsOptional()
  @IsUUID()
  colaboradorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsString()
  obs?: string;
}
