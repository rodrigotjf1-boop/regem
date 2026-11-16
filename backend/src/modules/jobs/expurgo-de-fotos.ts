// O EXPURGO LGPD DAS FOTOS (ponto, tarefa, desperdício, vistoria) POR LADO (ERR-075). Puro: sem banco, sem rede.
//
// O servidor da loja roda a mesma dist da nuvem, e as rotinas de expurgo rodam nos dois. Só que cada lado só consegue apagar
// o arquivo que mora com ele: a loja, a mídia LOCAL do disco dela (ela não tem a chave do storage — docs/seguranca-edge.md);
// a nuvem, a do STORAGE (Supabase). Antes, o lado que não conseguia apagar zerava a referência assim mesmo, a mudança vencia
// pelo sync no outro lado, e o arquivo ficava órfão para sempre. Agora cada lado pega só as fotos dele e só zera a referência
// quando o arquivo saiu. A nuvem sem storage configurado (desenvolvimento) guarda a mídia no próprio disco: aí ela cuida das locais.

/** O caminho em que a mídia local é servida (o mesmo do `MidiaService`). */
export const PREFIXO_DA_MIDIA_LOCAL = '/api/v1/publico/midia/';
/** O pedaço da URL pública do storage da nuvem (Supabase). */
export const MARCA_DO_STORAGE = '/storage/v1/object/public/';

/** Onde mora o arquivo da foto: no disco do processo (mídia local), no storage da nuvem — ou null (não é foto nossa). */
export function ondeMoraAFoto(ref: unknown): 'disco' | 'storage' | null {
  const r = String(ref ?? '');
  if (!r) return null;
  if (r.includes(PREFIXO_DA_MIDIA_LOCAL)) return 'disco';
  if (r.includes(MARCA_DO_STORAGE)) return 'storage';
  return null;
}

/** De onde ESTE lado apaga: a loja do disco; a nuvem do storage (ou do disco, quando ela não tem storage). */
export function ondeEsteLadoApaga(servidorLocal: boolean, storageNaNuvem: boolean): 'disco' | 'storage' {
  return servidorLocal || !storageNaNuvem ? 'disco' : 'storage';
}

/** O padrão `like` das fotos que este lado apaga. */
export function padraoDasFotosDoLado(servidorLocal: boolean, storageNaNuvem: boolean): string {
  return ondeEsteLadoApaga(servidorLocal, storageNaNuvem) === 'disco' ? `%${PREFIXO_DA_MIDIA_LOCAL}%` : `%${MARCA_DO_STORAGE}%`;
}

/** Esta foto é deste lado apagar? */
export const esteLadoApaga = (ref: unknown, servidorLocal: boolean, storageNaNuvem: boolean) =>
  ondeMoraAFoto(ref) === ondeEsteLadoApaga(servidorLocal, storageNaNuvem);
