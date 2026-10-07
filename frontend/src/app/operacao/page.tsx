'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { api, getToken, podeVerFinanceiro } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { ProdutosSecao } from '@/components/estoque/produtos-secao';
import { PainelSecao } from '@/components/estoque/painel-secao';
import { ContagemSecao } from '@/components/estoque/contagem-secao';
import { ComprasSecao } from '@/components/estoque/compras-secao';
import { EtiquetasSecao } from '@/components/estoque/etiquetas-secao';
import { RecebimentoSecao } from '@/components/estoque/recebimento-secao';
import { ValidadesSecao } from '@/components/estoque/validades-secao';
import { DesperdicioSecao } from '@/components/estoque/desperdicio-secao';
import { VistoriasSecao } from '@/components/estoque/vistorias-secao';
import { Shell } from '@/components/app-shell/shell';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Secao =
  | 'painel'
  | 'produtos'
  | 'contagem'
  | 'compras'
  | 'recebimento'
  | 'validades'
  | 'etiquetas'
  | 'desperdicio'
  | 'vistorias';

// `href` = seção que vive em outra rota (abre a página em vez de trocar a aba).
const SECOES: { key: Secao | 'fichas'; label: string; href?: string }[] = [
  { key: 'painel', label: 'Painel' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'fichas', label: 'Fichas técnicas', href: '/fichas' },
  { key: 'contagem', label: 'Contagem' },
  { key: 'compras', label: 'Compras' },
  { key: 'recebimento', label: 'Recebimento' },
  { key: 'validades', label: 'Validades' },
  { key: 'etiquetas', label: 'Etiquetas' },
  { key: 'desperdicio', label: 'Desperdício' },
  { key: 'vistorias', label: 'Vistorias' },
];

export default function EstoquePage() {
  const router = useRouter();
  const [secao, setSecao] = useState<Secao>('painel');
  const [itens, setItens] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [fornecedores, setFornecedores] = useState<any[]>([]);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');

  // O que VÁRIAS abas usam: produtos, categorias e fornecedores. As listas de cada aba
  // (recebimentos, lotes, desperdícios, vistorias…) cada seção carrega a sua, com o período.
  const reload = useCallback(async () => {
    try {
      // allSettled, NÃO all: o perfil de supervisão não tem permissão em tudo. Com
      // `Promise.all`, um único 403 (ex.: /fornecedores) rejeitava tudo e a tela inteira
      // ficava VAZIA — o operador achava que não havia estoque cadastrado.
      const r = await Promise.allSettled([
        api.get('/estoque/itens'),
        api.estoqueCategorias(),
        api.fornecedores(),
      ]);
      const val = <T,>(i: number, vazio: T): T =>
        r[i].status === 'fulfilled' ? ((r[i] as PromiseFulfilledResult<T>).value ?? vazio) : vazio;
      setItens(val(0, [] as any));
      setCategorias(val(1, [] as any));
      setFornecedores(val(2, [] as any));
      // Só avisa se TUDO falhou — falha parcial por permissão é esperada e silenciosa.
      const caiu = r.filter((x) => x.status === 'rejected');
      if (caiu.length === r.length) {
        const e = (caiu[0] as PromiseRejectedResult).reason;
        setErro(e instanceof Error ? e.message : 'Erro ao carregar');
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setPronto(true);
    }
  }, []);

  // Pausar automaticamente o item no cardápio ao esgotar o estoque (config global).
  const [autoPausa, setAutoPausa] = useState(true);
  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
    api.autoPausaCardapio().then((r: any) => r && setAutoPausa(!!r.ativo)).catch(() => {});
  }, [reload, router]);

  if (!pronto) {
    return (
      <Shell eyebrow="Insumos & produção" title="Estoque">
        <div>
          <SkeletonList rows={6} />
        </div>
      </Shell>
    );
  }

  const optCat: { id: string; nome: string }[] = categorias.map((c: any) => ({ id: c.id, nome: c.nome }));
  const optForn: { id: string; nome: string }[] = fornecedores.map((f: any) => ({ id: f.id, nome: f.nome }));

  const verFin = podeVerFinanceiro(); // valor do estoque (R$) conforme permissão do perfil

  return (
    <Shell
      eyebrow="Insumos & produção"
      title="Estoque"
      actions={
        <div className="flex flex-wrap gap-2">
          {/* Fichas técnicas desceu para a linha de seções (entre Produtos e Contagem). */}
          {/* Inteligência de estoque = motor de custo (financeiro) → só presidente/C&O */}
          {verFin && (
            <Button size="sm" variant="outline" onClick={() => router.push('/estoque')}>
              Inteligência <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Config global: pausa automática no cardápio ao esgotar o estoque */}
        <Card className="p-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">
              <span className="font-semibold">Pausar no cardápio ao esgotar o estoque</span>
              <span className="block text-xs text-secondary-foreground">
                Produto com estoque controlado vira &quot;Esgotado&quot; no cardápio quando o insumo acaba; volta sozinho ao repor.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 flex-none accent-primary"
              checked={autoPausa}
              onChange={async (e) => {
                const v = e.target.checked;
                setAutoPausa(v);
                try {
                  await api.setAutoPausaCardapio(v);
                  toast.success('Configuração salva.');
                } catch {
                  setAutoPausa(!v);
                  toast.error('Erro ao salvar.');
                }
              }}
            />
          </label>
        </Card>

        {/* Navegação por seção (hub) — rola na horizontal no mobile, quebra no desktop */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {SECOES.map((s) => {
            const ativo = !s.href && secao === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => (s.href ? router.push(s.href) : setSecao(s.key as Secao))}
                aria-pressed={ativo ? 'true' : 'false'}
                className={`min-h-10 shrink-0 whitespace-nowrap rounded-md border px-3.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  ativo
                    ? 'border-primary bg-primary font-bold text-primary-foreground'
                    : 'border-input bg-card font-semibold text-secondary-foreground hover:border-secondary-foreground hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {erro && <p role="alert" className="text-destructive">{erro}</p>}

        {/* ---------- PAINEL (E4) ---------- */}
        {secao === 'painel' && <PainelSecao itens={itens} />}

        {/* ---------- PRODUTOS (o cadastro do estoque) ---------- */}
        {secao === 'produtos' && (
          <ProdutosSecao itens={itens} categorias={optCat} fornecedores={optForn} verFin={verFin} reload={reload} />
        )}

        {/* ---------- CONTAGEM (E2) ---------- */}
        {secao === 'contagem' && <ContagemSecao itens={itens} />}

        {/* ---------- COMPRAS (E3) ---------- */}
        {secao === 'compras' && <ComprasSecao itens={itens} fornecedores={fornecedores} />}

        {/* ---------- RECEBIMENTO ---------- */}
        {secao === 'recebimento' && <RecebimentoSecao itens={itens} fornecedores={fornecedores} aoMudarEstoque={reload} />}

        {/* ---------- VALIDADES ---------- */}
        {secao === 'validades' && <ValidadesSecao itens={itens} aoMudarEstoque={reload} />}

        {/* ---------- ETIQUETAS DE VALIDADE ---------- */}
        {secao === 'etiquetas' && <EtiquetasSecao />}

        {/* ---------- DESPERDÍCIO ---------- */}
        {secao === 'desperdicio' && <DesperdicioSecao itens={itens} aoMudarEstoque={reload} />}

        {/* ---------- VISTORIAS ---------- */}
        {secao === 'vistorias' && <VistoriasSecao />}
      </div>
    </Shell>
  );
}
