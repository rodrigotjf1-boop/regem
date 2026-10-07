'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { texto2 } from '@/components/ui/lista';
import { ImpressorasLista } from '@/components/impressao/impressoras-lista';
import { PerfisCupom } from '@/components/impressao/perfis-cupom';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parte = 'impressoras' | 'perfis' | 'texto';
/** Uma leitura: o que veio, ou por que não veio. Leitura que falha NÃO vira lista vazia nem valor padrão. */
type Fonte<T> = { dado: T; erro?: undefined } | { dado?: undefined; erro: string };
const motivo = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Não foi possível carregar.');

const GRUPOS_TEXTO: GrupoDeAjustes[] = [
  {
    titulo: 'Texto do cupom',
    nota: 'O único texto livre do cupom. O que mais aparece, a ordem e o tamanho de cada linha ficam nos perfis de cupom.',
    itens: [
      { id: 'cabecalho', rotulo: 'Cabeçalho', ajuda: 'Texto do topo do cupom (o nome da loja).', tipo: 'texto', placeholder: 'REGEM' },
      { id: 'rodape', rotulo: 'Rodapé (mensagem final)', ajuda: 'Impresso no fim do cupom.', tipo: 'texto', placeholder: 'Obrigado pela preferência!' },
    ],
  },
];

// Configurações → Impressoras e cupons (mockup `mockups/regem-configuracoes.html`). Três partes:
//  • Impressoras — a lista, com ativar na linha, "Imprimir teste" e a edição na gaveta.
//  • Perfis de cupom — o que cada cupom imprime; edição na gaveta larga, um perfil por vez.
//  • Cabeçalho e rodapé — o texto livre do cupom.
// Cada parte lê a sua rota, com a sua permissão: a que falha mostra o motivo, sem derrubar as outras.
export default function ImpressaoPage() {
  const router = useRouter();
  const [parte, setParte] = useState<Parte>('impressoras');
  const [pode, setPode] = useState(false);
  const [impressoras, setImpressoras] = useState<Fonte<any[]> | null>(null);
  const [setores, setSetores] = useState<any[]>([]);
  const [peloServidorLocal, setPeloServidorLocal] = useState(false);
  const [perfis, setPerfis] = useState<Fonte<{ perfis: any[]; campos: any[] }> | null>(null);
  const [texto, setTexto] = useState<Fonte<true> | null>(null);
  const [salvos, setSalvos] = useState<Valores>({});
  const [valores, setValores] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const lerImpressoras = useCallback(async () => {
    try {
      setImpressoras({ dado: ((await api.impressoras()) as any[]) ?? [] });
    } catch (e) {
      setImpressoras({ erro: motivo(e) });
    }
  }, []);
  const lerPerfis = useCallback(async () => {
    try {
      const r: any = await api.cupomPerfis();
      setPerfis({ dado: { perfis: r?.perfis ?? [], campos: r?.campos ?? [] } });
    } catch (e) {
      setPerfis({ erro: motivo(e) });
    }
  }, []);
  const lerTexto = useCallback(async () => {
    try {
      const c: any = await api.deliveryConfig();
      const r: Valores = { cabecalho: c?.cupomLayout?.cabecalho ?? '', rodape: c?.cupomLayout?.rodape ?? '' };
      setSalvos(r);
      setValores(r);
      setTexto({ dado: true });
    } catch (e) {
      setTexto({ erro: motivo(e) });
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // O servidor só aceita mudança de presidente e gerente (o suporte entra como eles).
    setPode(['presidente', 'gerente', 'suporte'].includes(getCategoria() ?? ''));
    void lerImpressoras();
    void lerPerfis();
    void lerTexto();
    // Os setores só dão nome à coluna "Setor": sem acesso a eles a lista continua de pé.
    api.setores().then((s) => setSetores((s as any[]) ?? [])).catch(() => setSetores([]));
    // Loja com servidor local: a impressão é configurada nele (a nuvem recusa a edição). Sem
    // acesso a esta consulta, a tela segue editável e a recusa do servidor aparece ao salvar.
    api.edgeAtivo().then((r: any) => setPeloServidorLocal(!!r?.ativo)).catch(() => {});
  }, [router, lerImpressoras, lerPerfis, lerTexto]);

  async function salvarTexto() {
    const mudou = alterados(GRUPOS_TEXTO, valores, salvos);
    if (!mudou.length || salvando) return;
    setErro('');
    setSalvando(true);
    try {
      // Só as chaves que mudaram: o servidor mescla o texto do cupom e mantém o resto da configuração.
      await api.setDeliveryConfig({ cupomLayout: Object.fromEntries(mudou.map((k) => [k, String(valores[k] ?? '')])) });
      setSalvos(valores);
      toast.success('Cabeçalho e rodapé salvos.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const falhou = (titulo: string, msg: string, tentar: () => void) => (
    <Card className="space-y-3 p-5 text-sm">
      <p className="font-display text-base font-bold">{titulo}</p>
      <p role="alert">{msg}</p>
      <Button type="button" variant="outline" size="sm" onClick={tentar}>Tentar de novo</Button>
    </Card>
  );

  return (
    <Shell eyebrow="Configurações" title="Impressoras e cupons">
      <div className="space-y-4">
        <Partes<Parte>
          rotulo="Partes de Impressoras e cupons"
          ativa={parte}
          aoEscolher={setParte}
          partes={[
            { key: 'impressoras', label: 'Impressoras', conta: impressoras?.dado?.length ?? null },
            { key: 'perfis', label: 'Perfis de cupom', conta: perfis?.dado?.perfis.length ?? null },
            { key: 'texto', label: 'Cabeçalho e rodapé' },
          ]}
        />

        {parte === 'impressoras' &&
          (!impressoras ? (
            <SkeletonList rows={4} />
          ) : impressoras.erro !== undefined ? (
            falhou('Impressoras', impressoras.erro, () => { setImpressoras(null); void lerImpressoras(); })
          ) : (
            <ImpressorasLista impressoras={impressoras.dado} setores={setores} pode={pode} peloServidorLocal={peloServidorLocal} recarregar={lerImpressoras} />
          ))}

        {parte === 'perfis' &&
          (!perfis ? (
            <SkeletonList rows={5} />
          ) : perfis.erro !== undefined ? (
            falhou('Perfis de cupom', perfis.erro, () => { setPerfis(null); void lerPerfis(); })
          ) : (
            <PerfisCupom perfis={perfis.dado.perfis} catalogo={perfis.dado.campos} impressoras={impressoras?.dado ?? null} pode={pode} recarregar={lerPerfis} />
          ))}

        {parte === 'texto' &&
          (!texto ? (
            <SkeletonList rows={2} />
          ) : texto.erro !== undefined ? (
            falhou('Cabeçalho e rodapé do cupom', texto.erro, () => { setTexto(null); void lerTexto(); })
          ) : pode ? (
            <Ajustes
              id="texto"
              titulo="Cabeçalho e rodapé do cupom"
              grupos={GRUPOS_TEXTO}
              valores={valores}
              salvos={salvos}
              aoMudar={(k: string, v: Valor) => setValores((x) => ({ ...x, [k]: v }))}
              aoSalvar={() => void salvarTexto()}
              aoDescartar={() => { setValores(salvos); setErro(''); }}
              salvando={salvando}
              erro={erro}
            />
          ) : (
            <section className="space-y-3" aria-labelledby="texto-titulo">
              <h2 id="texto-titulo" tabIndex={-1} className="font-display text-lg font-bold outline-none">Cabeçalho e rodapé do cupom</h2>
              <Card className="p-4">
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
                  <dt className={`font-bold ${texto2}`}>Cabeçalho</dt>
                  <dd className="break-words">{String(salvos.cabecalho || '—')}</dd>
                  <dt className={`font-bold ${texto2}`}>Rodapé (mensagem final)</dt>
                  <dd className="break-words">{String(salvos.rodape || '—')}</dd>
                </dl>
              </Card>
              <p className={`text-sm ${texto2}`}>Só o presidente e o gerente mudam o texto do cupom.</p>
            </section>
          ))}
      </div>
    </Shell>
  );
}
