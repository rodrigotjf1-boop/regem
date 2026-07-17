import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

export class ConcluirTarefaDto {
  @IsIn(['em_execucao', 'feita', 'parcial', 'nao_feita', 'impossibilitada'])
  estado!: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;

  // Fotos de comprovação (até 3). Retenção de 30 dias (expurgo LGPD).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  fotos?: string[];

  @IsOptional()
  @IsBoolean()
  conclusaoEmMassa?: boolean;
}
