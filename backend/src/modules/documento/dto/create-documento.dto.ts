import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateDocumentoDto {
  @IsIn(['regimento', 'treinamento', 'comunicado', 'outro'])
  tipo!: string;

  @IsString()
  @MinLength(2)
  titulo!: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsString()
  escopo?: string;

  @IsOptional()
  conteudo?: unknown;
}
