import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateColaboradorDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  // E-mail de CONTATO (opcional). Desde a mig 141 quem entra é o `usuario`
  // (apelido) — o e-mail deixou de ser o identificador de login. Ao editar um
  // colaborador cadastrado sem e-mail, o form manda a string vazia `''`; como
  // `@IsOptional()` só pula null/undefined, um `@IsEmail()` cru rejeitava o `''`
  // ("email must be an email") e travava a edição. Validamos o formato só quando
  // há e-mail de fato; `''` passa e o service normaliza para null (limpa).
  @ValidateIf((o) => o.email !== undefined && o.email !== null && o.email !== '')
  @IsEmail()
  email?: string;

  // Senha de login (email+senha). Só para gestão (presidente/gerente/supervisão);
  // execução acessa por PIN no terminal de ponto. Validação de quem pode criar
  // qual nível fica no servidor.
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Senha deve ter ao menos 6 caracteres' })
  senha?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;

  // Função principal (compat). Se vazia, assume a 1ª de funcaoIds.
  @IsOptional()
  @IsUUID()
  funcaoId?: string;

  // Perfil de acesso (RBAC). Se vazio, resolve pelo nível da função principal.
  @IsOptional()
  @IsUUID()
  perfilAcessoId?: string;

  // Funções que o colaborador cobre (N:N). Uma ou mais.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  funcaoIds?: string[];

  @IsOptional()
  @IsIn(['clt', 'horista', 'diarista', 'pj', 'autonomo'])
  vinculo?: string;

  @IsOptional()
  @IsIn(['5x2', '6x1', '5x1', '12x36', '4x3', 'horista', 'outro'])
  jornadaTipo?: string;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'PIN deve ter de 4 a 6 dígitos' })
  pin?: string;

  // Loja do colaborador. Omitido = a loja em que o gestor está (ou a matriz).
  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  // Apelido de login (mig 141) — para quem não tem e-mail. Único na empresa.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,32}$/, {
    message: 'Usuário: 3 a 32 caracteres, sem espaço nem acento (letras, números, . _ -)',
  })
  usuario?: string;
}
