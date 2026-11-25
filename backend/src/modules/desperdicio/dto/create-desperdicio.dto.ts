import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateDesperdicioDto {
  // Ponto de registro: o equipamento `ponto_baixa` (leitor óptico) de onde veio a leitura.
  @IsOptional()
  @IsUUID()
  equipamentoId?: string;

  @IsString()
  @MinLength(2)
  descricao!: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  /** Lote de onde a perda saiu, quando se sabe (a etiqueta do lote — EST-F-02). Sai dele primeiro; o resto em FEFO. */
  @IsOptional()
  @IsUUID()
  loteId?: string;

  @IsOptional()
  @IsNumber()
  quantidade?: number;

  @IsOptional()
  @IsString()
  unidadeMedida?: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsUUID()
  colaboradorId?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;

  @IsOptional()
  @IsDateString()
  data?: string;
}
