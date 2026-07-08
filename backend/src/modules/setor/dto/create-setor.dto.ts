import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateSetorDto {
  @IsUUID()
  unidadeId!: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsString()
  icone?: string;

  @IsOptional()
  @IsString()
  cor?: string;
}
