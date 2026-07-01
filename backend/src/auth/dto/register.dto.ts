import { IsEmail, IsString, MinLength } from 'class-validator';

// Onboarding: cria empresa (tenant) + função Presidente + primeiro colaborador.
export class RegisterDto {
  @IsString()
  @MinLength(2)
  empresaNome!: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  senha!: string;
}
