import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// Onboarding: cria empresa (tenant) + função Presidente + primeiro colaborador +
// unidade MATRIZ (a "loja" que desce pro edge no primeiro login).
export class RegisterDto {
  @IsString()
  @MinLength(2)
  empresaNome!: string;

  // Endereço da matriz (opcional no cadastro; editável depois em Cadastros).
  @IsOptional()
  @IsString()
  endereco?: string;

  // CNPJ da empresa — âncora anti-burla do trial (1 trial por CNPJ). Aceita com
  // ou sem máscara; a validação de dígitos é feita no service.
  @IsString()
  @MinLength(11)
  cnpj!: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  senha!: string;
}
