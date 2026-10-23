import { createHash } from 'node:crypto';

// ID QUE NASCE DA CHAVE DE NEGÓCIO (mesma regra da pausa por estoque, migs 260/261).
//
// Por que existe: tarefa e escala são materializadas por rotina, e a rotina roda na nuvem
// E no servidor local. Com `id` aleatório, cada lado cria a MESMA tarefa do mesmo dia com
// um id diferente — e o sincronismo, que casa linha por id, duplicaria em vez de
// conciliar (a tarefa apareceria duas vezes no Meu Dia, a pessoa duas vezes no turno).
//
// Derivando o id da chave de negócio, os dois lados chegam ao MESMO id sem combinar nada:
// quem chegar depois vira atualização da mesma linha, não linha nova.
//
// ⚠️ Tem de bater byte a byte com o `md5(...)::uuid` do Postgres usado nas migrations —
// é a mesma conta: md5 do texto concatenado, lido como uuid. Mudar a ordem ou o separador
// muda o id de tudo; a migration que reescrever ids precisa usar exatamente esta regra.
export function uuidDeChave(...partes: (string | null | undefined)[]): string {
  const hex = createHash('md5').update(partes.map((p) => p ?? '').join('')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Tarefa do dia: a definição, a loja e o dia.
export const idTarefaInstancia = (tarefaDefId: string, unidadeId: string | null, data: string) =>
  uuidDeChave(tarefaDefId, unidadeId, data);

// Escala: a loja, o dia, o turno e a pessoa. Vaga em aberto (sem pessoa) NÃO usa isto —
// várias vagas no mesmo turno são legítimas e não são materializadas pelos dois lados.
export const idEscalaAlocacao = (
  unidadeId: string | null,
  data: string,
  turnoId: string,
  colaboradorId: string,
) => uuidDeChave(unidadeId, data, turnoId, colaboradorId);

// Série fiscal: a empresa, a loja e a ORIGEM ('loja' | 'nuvem'). A linha é criada sob
// demanda pelo lado que for emitir primeiro; derivando o id, os dois lados criam a MESMA
// linha — e a migration 278 semeia com esta mesma conta.
export const idFiscalSerie = (tenantId: string, unidadeId: string | null, origem: string) =>
  uuidDeChave(tenantId, unidadeId, origem);

// Configuração de LINHA ÚNICA por empresa e loja (sem loja = a linha da empresa), que a nuvem e o servidor da loja
// criam cada um do seu lado: com id aleatório, as duas linhas da mesma chave se recusavam no sincronismo para sempre
// (23505 no índice único da chave) — o cabeçalho e o rodapé salvos na nuvem não chegavam à impressora da loja (fase 3,
// 23/10/2026). A tabela entra na conta para o id de uma não coincidir com o de outra. Mesma conta da migration 339.
export type TabelaConfigDaLoja = 'delivery_config' | 'tef_config' | 'kds_cor_config';
export const idConfigDaLoja = (tabela: TabelaConfigDaLoja, tenantId: string, unidadeId: string | null | undefined) =>
  uuidDeChave(tabela, tenantId, unidadeId ?? null);

// Liga/desliga da empresa (`entitlement`): a empresa e o módulo. Mesma razão e mesma migration.
export const idEntitlement = (tenantId: string, modulo: string) => uuidDeChave('entitlement', tenantId, modulo);
