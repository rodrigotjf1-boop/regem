import { IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class CreateTurnoDto {
  @IsUUID()
  unidadeId!: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'horaInicio deve ser HH:MM' })
  horaInicio!: string;

  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'horaFim deve ser HH:MM' })
  horaFim!: string;
}
