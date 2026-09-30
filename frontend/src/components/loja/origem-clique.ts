import { OrigemClique, origemDaUrl, proximaOrigem } from './origem-clique-regras';

// De onde o cliente veio (trilha C, C3a): guardado no `sessionStorage` do próprio cardápio — só
// enquanto a aba estiver aberta (decisão do dono), sem cookie e sem terceiro. Só é chamado na loja
// que mede anúncios (`loja.medeAnuncios`) e nunca no QR da mesa. "Não registrar" apaga a origem e
// vale até fechar a aba.

const chave = (token: string) => `regem_loja_origem_${token}`;
const chaveRecusa = (token: string) => `regem_loja_origem_recusada_${token}`;

function sessao(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // bloqueado pelo navegador
  }
}

export function lerOrigem(token: string): OrigemClique | null {
  try {
    const v = sessao()?.getItem(chave(token));
    return v ? (JSON.parse(v) as OrigemClique) : null;
  } catch {
    return null;
  }
}

export function origemRecusada(token: string): boolean {
  try {
    return sessao()?.getItem(chaveRecusa(token)) === '1';
  } catch {
    return false;
  }
}

/** Ao abrir o cardápio: link marcado substitui, sem marca mantém. Recusada nesta aba: nada. */
export function capturarOrigem(token: string, params: { get(nome: string): string | null } | null): OrigemClique | null {
  if (origemRecusada(token)) return null;
  const daUrl = origemDaUrl(params);
  const origem = proximaOrigem(lerOrigem(token), daUrl);
  if (daUrl) {
    try {
      sessao()?.setItem(chave(token), JSON.stringify(daUrl));
    } catch {
      /* cota/privado — segue sem guardar */
    }
  }
  return origem;
}

/** "Não registrar": apaga a origem do aparelho e marca a recusa até fechar a aba. */
export function recusarOrigem(token: string) {
  try {
    sessao()?.removeItem(chave(token));
    sessao()?.setItem(chaveRecusa(token), '1');
  } catch {
    /* ignora */
  }
}

/** "Desfazer": volta a origem que estava na tela e tira a recusa. */
export function desfazerRecusa(token: string, origem: OrigemClique | null) {
  try {
    sessao()?.removeItem(chaveRecusa(token));
    if (origem) sessao()?.setItem(chave(token), JSON.stringify(origem));
  } catch {
    /* ignora */
  }
}

/** A origem que vai com o pedido agora (lida do aparelho: o que foi apagado não vai). */
export function origemParaPedido(token: string): OrigemClique | null {
  return origemRecusada(token) ? null : lerOrigem(token);
}

/** Esquece tudo (junto com o "Sair"/"Excluir conta" do cliente). */
export function apagarOrigem(token: string) {
  try {
    sessao()?.removeItem(chave(token));
    sessao()?.removeItem(chaveRecusa(token));
  } catch {
    /* ignora */
  }
}
