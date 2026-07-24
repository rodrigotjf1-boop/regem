import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

// Login por E-MAIL (gestão, como sempre foi) ou por USUÁRIO/apelido (mig 141),
// que é o caminho de quem não tem e-mail — atendente, estoquista, garçom.
// `identificador` é o campo novo; `email` continua aceito para não quebrar
// clientes já publicados.
export class LoginDto {
  @IsOptional()
  @IsString()
  identificador?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  @MinLength(1)
  senha!: string;

  // Escopo do workspace: com ele o usuário é procurado só nesta empresa — é o
  // que permite um "joao" em cada loja sem colidir.
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
