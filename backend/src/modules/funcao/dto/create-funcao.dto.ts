import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateFuncaoDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsIn(['presidente', 'gerente', 'supervisao', 'execucao'])
  categoria?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  // Fase 3: gerar a etiqueta (vaga) desta função automaticamente.
  @IsOptional()
  @IsBoolean()
  gerarEtiqueta?: boolean;

  // Sigla da etiqueta; se vazia e gerarEtiqueta, o backend abrevia do nome.
  @IsOptional()
  @IsString()
  sigla?: string;
}
