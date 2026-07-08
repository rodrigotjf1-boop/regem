import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { CreatePassoDto } from './create-passo.dto';

export class CreateGuiaDto {
  @IsString()
  @MinLength(2)
  titulo: string;

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

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsArray()
  passos?: CreatePassoDto[];
}
