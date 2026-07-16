import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUnidadeDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsIn(['matriz', 'filial'])
  tipo?: string;

  @IsOptional()
  @IsString()
  endereco?: string;
}
