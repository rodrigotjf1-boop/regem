import { SetMetadata } from '@nestjs/common';

// Marca um handler/controller como pertencente a um MÓDULO ativável (KDS, Terminal
// de Ponto, App do Colaborador, Bot). O ModuloGuard corta o acesso no servidor
// quando o presidente desligou o módulo para a rede/loja. Ver [[modulos-ativaveis]].
export const MODULO_KEY = 'modulo_requerido';
export const RequireModulo = (chave: string) => SetMetadata(MODULO_KEY, chave);
