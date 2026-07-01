import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUnidadeDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsString()
  endereco?: string;
}
