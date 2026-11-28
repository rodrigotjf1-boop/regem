import { IsOptional, IsString, MaxLength } from 'class-validator';

/** "Liberar o pedido" (TR-4): a senha do gerente e o motivo. O serviço confere os dois (V100: decorador em cada campo). */
export class LiberarTravaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  senha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  motivo?: string;
}
