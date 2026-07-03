import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ResponderClimaDto {
  // 1=muito ruim .. 5=muito bom
  @IsInt()
  @Min(1)
  @Max(5)
  humor!: number;

  @IsOptional()
  @IsString()
  comentario?: string;
}
