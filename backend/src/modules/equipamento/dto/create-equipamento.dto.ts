import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateEquipamentoDto {
  @IsIn(['kds', 'terminal_ponto', 'servidor_local'])
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
}
