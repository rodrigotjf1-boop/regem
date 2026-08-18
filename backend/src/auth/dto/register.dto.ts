import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { IsCnpj } from '../../common/validadores-br';

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
  // ou sem máscara. @IsCnpj rejeita cedo (dígitos verificadores); o service ainda
  // reconfere e consulta a existência na Receita (BrasilAPI).
  @IsString()
  @MinLength(11)
  @IsCnpj()
  cnpj!: string;

  @IsString()
  @MinLength(2)
  nome!: string;

  @IsEmail()
  email!: string;

  // Usuário de acesso do dono — ele já nasce presidente e loga por este apelido
  // (o e-mail passa a ser contato). É o que o 2º passo do login pede.
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,32}$/, {
    message: 'Usuário: 3 a 32 caracteres, sem espaço nem acento (letras, números, . _ -)',
  })
  usuario!: string;

  @IsString()
  @MinLength(6)
  senha!: string;
}
