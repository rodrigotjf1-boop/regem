import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { IsCnpj, IsTelefoneBr } from '../../../common/validadores-br';

export class CreateFornecedorDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsString()
  @IsCnpj()
  cnpj?: string;

  @IsOptional()
  @IsString()
  contato?: string;

  @IsOptional()
  @IsString()
  @IsTelefoneBr()
  telefone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  email?: string;

  @IsOptional()
  @IsString()
  obs?: string;
}
