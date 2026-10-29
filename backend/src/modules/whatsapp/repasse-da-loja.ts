import { HttpException, HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { causaDeRede } from '../../common/causa-de-rede';

/* eslint-disable @typescript-eslint/no-explicit-any */

const log = new Logger('CaixaDaLoja');

export type PedidoDeRepasse = {
  metodo: 'GET' | 'POST';
  /** Depois de `whatsapp/da-loja/` — ex.: 'conversas'. */
  caminho: string;
  query?: Record<string, string | undefined>;
  corpo?: unknown;
  /** O colaborador logado AQUI: a nuvem confere a empresa e registra quem pausou/respondeu. */
  usuario: { tenantId: string; colaboradorId: string };
};

/**
 * Repassa uma chamada da caixa de conversas do WhatsApp à NUVEM (whatsapp/da-loja), com o token deste servidor. A
 * resposta volta como veio: o status e o corpo de erro da nuvem viram o erro desta chamada (a tela mostra a mesma
 * mensagem). Sem a nuvem (sem internet, nuvem fora do ar): 503 com texto que a tela entende, e o MOTIVO real no log.
 */
export async function repassarParaNuvem(p: PedidoDeRepasse, buscar: typeof fetch = fetch): Promise<any> {
  const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
  const token = process.env.SYNC_TOKEN ?? '';
  if (!nuvem || !token) {
    log.warn('caixa de conversas sem a nuvem: este servidor não tem CLOUD_API/SYNC_TOKEN');
    throw new ServiceUnavailableException('Este servidor da loja não está ligado à nuvem — a caixa de conversas não abre.');
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p.query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${nuvem}/whatsapp/da-loja/${p.caminho}${qs.toString() ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    'x-sync-token': token,
    'x-regem-empresa': p.usuario.tenantId,
    'x-regem-usuario': p.usuario.colaboradorId,
  };
  if (p.metodo === 'POST') headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await buscar(url, {
      method: p.metodo,
      headers,
      ...(p.metodo === 'POST' ? { body: JSON.stringify(p.corpo ?? {}) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e: any) {
    const causa = causaDeRede(e);
    log.warn(`caixa de conversas: ${p.metodo} ${p.caminho} sem resposta da nuvem: ${e?.message ?? e}${causa ? ` — ${causa}` : ''}`);
    throw new ServiceUnavailableException('Sem conexão com a nuvem agora — a caixa de conversas volta quando a internet voltar.');
  }

  const texto = await res.text().catch(() => '');
  let corpo: any = texto;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    /* corpo não-JSON: segue como texto */
  }
  if (!res.ok) {
    if (res.status >= 500) log.warn(`caixa de conversas: ${p.metodo} ${p.caminho} → a nuvem respondeu ${res.status}`);
    throw new HttpException(
      corpo && typeof corpo === 'object' ? corpo : { statusCode: res.status, message: String(corpo || 'Falha na nuvem.') },
      res.status || HttpStatus.BAD_GATEWAY,
    );
  }
  return corpo;
}
