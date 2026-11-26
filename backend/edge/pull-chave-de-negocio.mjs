// O PULL E A CHAVE DE NEGÓCIO (ERR-616, 1.30.16). ESM puro, sem import: o teste avalia este arquivo como texto.
//
// O pull grava a linha da nuvem pelo `id` (upsert `on conflict (id)`). Uma tabela com índice único de NEGÓCIO recusa
// (23505) quando o mesmo fato já existe aqui com outro id — o vínculo produto × fornecedor criado na loja e na nuvem, ou
// recriado depois de excluir. Antes isso caía como "erro duro": a linha era pulada, o cursor andava e o vínculo nunca
// chegava à loja (4 linhas em 25/11/2026). Agora, nessas tabelas, a loja ADOTA o id da nuvem: tira a sua cópia de mesma
// chave e grava a da nuvem. Nada aponta para o id dessas tabelas, e a sessão do daemon é de sync (não gera exclusão).

/** Tabela → as colunas do índice único de negócio (além do `id`). Só entra tabela que ninguém referencia pelo id. */
export const CHAVES_DE_NEGOCIO = {
  item_fornecedor: ['item_id', 'fornecedor_id'],
};

/**
 * O comando que tira a cópia local de MESMA chave e outro id, para a linha da nuvem entrar — ou null se a tabela não
 * tem chave de negócio aqui ou a linha não traz a chave inteira. Valores por parâmetro ($1 = id da nuvem).
 */
export function sqlAdotarIdDaNuvem(tabela, row) {
  const chave = CHAVES_DE_NEGOCIO[tabela];
  if (!chave || !row || !row.id || chave.some((c) => row[c] === undefined || row[c] === null)) return null;
  const condicao = chave.map((c, i) => `${c} = $${i + 2}`).join(' and ');
  return { text: `delete from ${tabela} where ${condicao} and id <> $1`, values: [row.id, ...chave.map((c) => row[c])] };
}
