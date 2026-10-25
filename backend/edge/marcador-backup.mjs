// O RESULTADO DO ÚLTIMO BACKUP, como o sinal de saúde do servidor da loja manda à nuvem.
//
// O backup.ps1 grava backups\ultimo-backup.json (no sucesso e na falha); o sync-daemon lê aqui e manda a idade e o
// resultado — é assim que a nuvem sabe que uma loja parou de fazer backup. Lido do ARQUIVO (não do banco): com o
// Postgres fora, o backup do dia anterior ainda precisa ser reportado.
//
// BOM: o backup.ps1 gravava com [Text.Encoding]::UTF8 (com BOM) e o JSON.parse falhava no primeiro caractere — a nuvem
// via "backup falhou" em toda loja, com o backup em dia. O backup.ps1 novo grava sem BOM; a leitura aceita os dois,
// porque o script antigo segue instalado até a atualização trocá-lo.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** `dirBk` = a pasta backups (irmã da raiz do backend). Devolve { ok, em, horas, mb, erro }. Nunca lança. */
export function lerStatusDoBackup(dirBk, agoraMs = Date.now()) {
  try {
    const marcador = join(dirBk, 'ultimo-backup.json');
    if (existsSync(marcador)) {
      const m = JSON.parse(readFileSync(marcador, 'utf8').replace(/^\uFEFF/, ''));
      return {
        ok: !!m.ok,
        em: m.em ?? null,
        horas: m.em ? Math.round((agoraMs - new Date(m.em).getTime()) / 36e5) : null,
        mb: m.bytes ? Math.round(Number(m.bytes) / 1048576) : null,
        erro: m.erro ? String(m.erro).slice(0, 200) : null,
      };
    }
    if (existsSync(dirBk)) {
      // Instalação anterior ao marcador: usa o arquivo mais novo da pasta.
      let maisNovo = null;
      for (const f of readdirSync(dirBk).filter((x) => x.startsWith('db-') && x.endsWith('.dump.enc'))) {
        const st = statSync(join(dirBk, f));
        if (!maisNovo || st.mtimeMs > maisNovo.mtimeMs) maisNovo = { mtimeMs: st.mtimeMs, size: st.size };
      }
      return maisNovo
        ? { ok: true, em: new Date(maisNovo.mtimeMs).toISOString(), horas: Math.round((agoraMs - maisNovo.mtimeMs) / 36e5), mb: Math.round(maisNovo.size / 1048576), erro: null }
        : { ok: false, em: null, horas: null, mb: null, erro: 'nenhum backup encontrado' };
    }
    return { ok: false, em: null, horas: null, mb: null, erro: 'pasta de backups inexistente' };
  } catch (e) {
    return { ok: false, em: null, horas: null, mb: null, erro: `não consegui ler: ${e.message}` };
  }
}
