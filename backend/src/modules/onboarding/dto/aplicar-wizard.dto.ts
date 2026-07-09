import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class AplicarWizardDto {
  @IsUUID()
  unidadeId!: string;

  @IsString()
  ramo!: string;

  // Nomes dos setores selecionados (subconjunto do blueprint do ramo).
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  setores!: string[];

  // Nomes das funções selecionadas.
  @IsArray()
  @IsString({ each: true })
  funcoes!: string[];

  // Modelos de escala marcados (informativo).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  escalas?: string[];

  // Semear os insumos básicos do ramo no estoque da unidade (idempotente).
  @IsOptional()
  @IsBoolean()
  criarInsumos?: boolean;
}
