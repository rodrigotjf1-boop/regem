import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateComunicadoDto {
  @IsString()
  @MinLength(2)
  titulo!: string;

  @IsOptional()
  @IsString()
  corpo?: string;

  @IsOptional()
  @IsIn(['rede', 'loja', 'setor'])
  audiencia?: 'rede' | 'loja' | 'setor';

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsBoolean()
  fixado?: boolean;
}
