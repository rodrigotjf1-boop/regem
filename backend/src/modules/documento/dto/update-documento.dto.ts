import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateDocumentoDto {
  @IsOptional()
  @IsIn(['regimento', 'treinamento', 'comunicado', 'outro'])
  tipo?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  titulo?: string;

  @IsOptional()
  @IsString()
  escopo?: string;

  @IsOptional()
  conteudo?: unknown;
}
