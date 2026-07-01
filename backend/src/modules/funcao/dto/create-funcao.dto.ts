import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateFuncaoDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsIn(['presidente', 'gerente', 'supervisao', 'execucao'])
  categoria?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;
}
