import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { fetchExterno } from '../../common/fetch-externo';

// R3c — repasse das rotas que continuam sendo da NUVEM do GoGeM.
//
// O totem tem UM endereço só (o servidor). Catálogo e venda o edge resolve sozinho;
// pareamento, telemetria, atualização e PAGAMENTO seguem na nuvem — o pagamento porque
// a credencial do PSP mora lá e a maquininha cobra pela internet dela.
// É repasse burro de propósito: mesmo método, mesmo caminho, mesmo corpo. Nada de
// interpretar o conteúdo — se o contrato do GoGeM mudar, o repasse continua valendo.
const GOGEM_NUVEM_PADRAO = 'https://api.gogem.com.br/api/v1';

/** Cabeçalhos que fazem sentido atravessar. O resto é da conexão local. */
const CABECALHOS = [
  'x-device-token',
  'content-type',
  'accept',
  'idempotency-key',
  'x-loja-token',
];

/**
 * Caminho que vai para a nuvem: o mesmo que o totem pediu, sem o prefixo global da API.
 * Preserva a query (o `?desde=`, o id da cobrança…). Função separada porque errar aqui
 * manda a requisição para o lugar errado — e isso é pagamento.
 */
export function caminhoParaNuvem(originalUrl: string | undefined): string {
  const bruto = String(originalUrl ?? '');
  const semPrefixo = bruto.replace(/^\/api\/v1(?=\/|$)/, '');
  return semPrefixo.startsWith('/') ? semPrefixo : `/${semPrefixo}`;
}

@Injectable()
export class GogemProxyService {
  private readonly logger = new Logger('TotemProxy');

  private base(): string {
    return (process.env.GOGEM_CLOUD_URL || GOGEM_NUVEM_PADRAO).replace(/\/$/, '');
  }

  /**
   * Encaminha a requisição do totem para a nuvem do GoGeM e devolve o que vier —
   * status e corpo inalterados. Falha de rede vira 503 com mensagem legível para a tela
   * do totem, e o MOTIVO real vai para o log do servidor (não se engole erro).
   */
  async encaminhar(req: any): Promise<{ status: number; corpo: unknown }> {
    const caminho = caminhoParaNuvem(req.originalUrl ?? req.url);
    const url = `${this.base()}${caminho}`;
    const headers: Record<string, string> = {};
    for (const h of CABECALHOS) {
      const v = req.headers?.[h];
      if (v) headers[h] = Array.isArray(v) ? v[0] : String(v);
    }
    const metodo = String(req.method ?? 'GET').toUpperCase();
    const temCorpo = metodo !== 'GET' && metodo !== 'HEAD';
    if (temCorpo && !headers['content-type']) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await fetchExterno(url, {
        method: metodo,
        headers,
        ...(temCorpo ? { body: JSON.stringify(req.body ?? {}) } : {}),
      });
    } catch (e: any) {
      this.logger.warn(`repasse ${metodo} ${caminho} falhou: ${e?.message ?? e}`);
      throw new ServiceUnavailableException(
        'Sem conexão com a nuvem agora — tente de novo em instantes.',
      );
    }

    const texto = await res.text().catch(() => '');
    let corpo: unknown = texto;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      /* resposta não-JSON: devolve o texto como veio */
    }
    if (!res.ok) {
      this.logger.warn(
        `repasse ${metodo} ${caminho} → ${res.status} ${res.statusText}: ${texto.slice(0, 200)}`,
      );
    }
    return { status: res.status, corpo };
  }
}
