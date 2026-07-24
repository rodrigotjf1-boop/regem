import { IsOptional, IsString, MinLength } from 'class-validator';
import { IsCnpj } from '../../../common/validadores-br';

export class CreateEmpresaDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  // Confere os dígitos verificadores (aceita com ou sem máscara).
  @IsOptional()
  @IsString()
  @IsCnpj()
  cnpj?: string;

  @IsOptional()
  @IsString()
  ramo?: string;

  @IsOptional()
  @IsString()
  plano?: string;
}
