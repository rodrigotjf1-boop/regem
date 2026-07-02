import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

// Inclusão manual de marcação esquecida (gestor). Vira ponto_marcacao origem='ajuste'.
export class IncluirMarcacaoDto {
  @IsUUID()
  colaboradorId!: string;

  @IsIn(['entrada', 'saida', 'intervalo_inicio', 'intervalo_fim'])
  tipo!: string;

  @IsDateString()
  marcadoEm!: string; // data+hora da marcação esquecida

  @IsString()
  @MinLength(3)
  justificativa!: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;
}
