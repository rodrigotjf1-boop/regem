// Os tipos do Clube de recompra (Delivery › Marketing › Clube; mig 471, fase A0) — o que o servidor manda no painel.
export type TipoDePremio = 'percentual' | 'valor' | 'fretegratis' | 'produto';
export type Ferramenta = 'surpresa' | 'album' | 'meta';

export type PremioDoClube = {
  id: string;
  nome: string;
  tipo: TipoDePremio;
  valor: number;
  teto: number | null;
  produtoId: string | null;
  produtoNome: string | null;
  minimo: number;
  validadeDias: number;
  descricao: string;
  /** Onde o prêmio está em uso ("Álbum de selos", "Meta do mês, nível 1"); vazio = sem uso. */
  emUso: string[];
};

export type ConfigDoClube = {
  surpresaAtivo: boolean;
  surpresaForma: 'raspadinha' | 'roleta';
  albumAtivo: boolean;
  albumSelos: number;
  albumValidadeMeses: number;
  albumPremios: string[];
  metaAtivo: boolean;
  metaNiveis: { pedidos: number; premios: string[] }[];
  metaValidadeDias: number;
  minimo: number;
};

/** O gatilho "Pedido entregue" do prêmio surpresa (mig 474): `desde` = quando foi ligado (só os pedidos depois ganham). */
export type GatilhoEntregue = { ativo: boolean; premioId: string | null; desde: string | null };
/** O gatilho "Depois de uma reclamação" (A1b): os prêmios que a equipe pode mandar, o limite por cliente e quem manda. */
export type GatilhoReclamacao = { ativo: boolean; premios: string[]; limite: string; quem: string };
/** O gatilho "Pela classificação do marketing" (A1c): os segmentos do perfil do cliente, o prêmio e o período. */
export type GatilhoClassificacao = { ativo: boolean; segmentos: string[]; premioId: string | null; periodoDias: number };
export type Opcao = { valor: string; rotulo: string };

export type PainelDoClube = {
  config: ConfigDoClube;
  /** As ferramentas que já existem para ligar — a que não existe não mostra o liga/desliga. */
  prontas: Record<Ferramenta, boolean>;
  /** Os gatilhos do prêmio surpresa (fase A1: só o "Pedido entregue"). */
  gatilhos: { entregue: GatilhoEntregue; reclamacao: GatilhoReclamacao; classificacao: GatilhoClassificacao };
  /** Os segmentos vêm do perfil do cliente: ligado e quantos há em cada um (desligado, sem contagem). */
  classificacao: { perfilLigado: boolean; contagens: Record<string, number> };
  premios: PremioDoClube[];
  /** As regras do clube que o cliente lê (o link "Regras do clube"). */
  regras: string[];
  opcoes: {
    validadesDoPremio: number[];
    minimoMax: number;
    nomeMax: number;
    premiosMax: number;
    premiosPorEscolhaMax: number;
    limitesDaReclamacao: Opcao[];
    quemMandaDesculpas: Opcao[];
    segmentosDaClassificacao: Opcao[];
    periodosDaClassificacao: number[];
  };
};

export const NOME_DO_TIPO: Record<TipoDePremio, string> = {
  percentual: 'Desconto em %',
  valor: 'Desconto em R$',
  fretegratis: 'Frete grátis',
  produto: 'Produto grátis',
};
