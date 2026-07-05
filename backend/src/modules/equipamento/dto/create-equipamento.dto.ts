import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateEquipamentoDto {
  @IsIn(['kds', 'terminal_ponto', 'servidor_local', 'impressora'])
  tipo!: string;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsString()
  mac?: string;

  @IsOptional()
  @IsIn(['producao', 'avisos'])
  escopo?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  porta?: number;
}
