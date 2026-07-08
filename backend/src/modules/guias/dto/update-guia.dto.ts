import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';
import { CreatePassoDto } from './create-passo.dto';

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
  alcance?: string;

  @IsOptional()
  @IsString()
  responsavelExecuta?: string;

  @IsOptional()
  @IsString()
  responsavelSupervisiona?: string;

  @IsOptional()
  @IsString()
  materiais?: string;

  @IsOptional()
  revisaoMeses?: number;

  @IsOptional()
  @IsString()
  logoRef?: string;

  @IsOptional()
  @IsString()
  formato?: string; // listado | ilustrado

  @IsOptional()
  @IsString()
  estiloIlustracao?: string;

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

  // Se enviado, SUBSTITUI todos os passos (replace-all).
  @IsOptional()
  @IsArray()
  passos?: CreatePassoDto[];
}
