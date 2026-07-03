import { IsInt, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCategoriaDto {
  @IsString()
  @MinLength(1)
  nome!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  ordem?: number;
}
