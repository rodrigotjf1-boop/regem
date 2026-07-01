import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateTarefaDefDto {
  @IsUUID()
  unidadeId!: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsIn(['recorrente', 'avulsa'])
  origem?: string;

  @IsString()
  @MinLength(2)
  titulo!: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsUUID()
  etiquetaId?: string;

  @IsOptional()
  @IsUUID()
  colaboradorOverrideId?: string;

  @IsOptional()
  @IsString()
  recorrenciaTipo?: string;

  @IsOptional()
  @IsBoolean()
  proibidaNoPico?: boolean;

  @IsOptional()
  @IsBoolean()
  antecipavel?: boolean;
}
