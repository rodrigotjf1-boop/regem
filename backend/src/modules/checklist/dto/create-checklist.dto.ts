import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateChecklistDto {
  @IsUUID()
  unidadeId!: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsString()
  @MinLength(2)
  nome!: string;
}
