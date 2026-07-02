import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateGuiaDto {
  @IsOptional()
  @IsString()
  titulo?: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsString()
  ramo?: string;

  @IsOptional()
  @IsString()
  frequencia?: string;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  funcaoId?: string;
}
