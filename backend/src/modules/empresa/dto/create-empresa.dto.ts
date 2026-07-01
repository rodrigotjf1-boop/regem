import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmpresaDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsString()
  ramo?: string;

  @IsOptional()
  @IsString()
  plano?: string;
}
