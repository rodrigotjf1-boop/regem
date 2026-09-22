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
