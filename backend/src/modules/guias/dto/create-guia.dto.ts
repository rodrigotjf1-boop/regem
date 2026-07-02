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
