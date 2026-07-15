'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bike,
  Boxes,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  ReceiptText,
  FileText,
  Flame,
  HardDrive,
  History,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  Wand2,
} from 'lucide-react';
import { clearToken, getCategoria, getPermissoes, getToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import { RegemMark } from '@/components/brand/regem-mark';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { LicencaAviso } from '@/components/licenca/licenca-aviso';
import { ModoOperacao } from '@/components/ui/modo-operacao';
import { ServidorOfflineAviso } from '@/components/ui/servidor-offline-aviso';
import { useUiPrefs } from '@/hooks/use-ui-prefs';
import { AccountMenu } from './account-menu';

// Item de submenu (2º nível). `perm` = permissão do catálogo que libera o item.
type NavSub = { href: string; label: string; icon: LucideIcon; perm: string };
// Nó de 1º nível: pode ser um link direto (href) e/ou um grupo com `children`.
type NavNode = {
  label: string;
  icon: LucideIcon;
  href?: string;
  perm?: string;
  children?: NavSub[];
};

// Menu por PERMISSÃO (catálogo do perfil_acesso). Cada item aparece se o perfil
// tem a permissão (presidente sempre vê tudo). Estrutura = organização nova
// (14 grupos + submenus). Garçom e Bot ficam fora do menu (acessados à parte).
const NAV: NavNode[] = [
  { href: '/painel', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' },
  {
    label: 'PDV · Balcão', icon: ShoppingCart,
    children: [
      { href: '/pdv', label: 'Balcão', icon: ShoppingCart, perm: 'pdv' },
      { href: '/mesas', label: 'Mesas e comandas', icon: ClipboardList, perm: 'mesas' },
      { href: '/cupons', label: 'Cupons', icon: ReceiptText, perm: 'cupons' },
    ],
  },
  {
    label: 'Delivery', icon: Bike,
    children: [
      { href: '/delivery', label: 'Painel', icon: Bike, perm: 'delivery' },
      { href: '/pedidos', label: 'Pedidos · produção', icon: Flame, perm: 'pedidos' },
    ],
  },
  { href: '/meu-dia', label: 'Meu Dia', icon: ListChecks, perm: 'meu_dia' },
  { href: '/escala', label: 'Escalas', icon: CalendarDays, perm: 'escalas' },
  { href: '/operacao', label: 'Estoque', icon: Boxes, perm: 'estoque' },
  { href: '/docs', label: 'Checklist & registros', icon: ClipboardList, perm: 'checklist' },
  { href: '/mural', label: 'Mural & clima', icon: Megaphone, perm: 'mural' },
  {
    label: 'Financeiro', icon: Wallet,
    children: [
      { href: '/formas-pagamento', label: 'Formas de pagamento', icon: CreditCard, perm: 'formas_pagamento' },
      { href: '/notas', label: 'Notas fiscais', icon: ReceiptText, perm: 'fiscal' },
      { href: '/tef', label: 'TEF / maquininha', icon: CreditCard, perm: 'tef' },
      { href: '/fiscal-config', label: 'Configuração', icon: Coins, perm: 'fiscal_config' },
    ],
  },
  { href: '/cadastros', label: 'Cadastros', icon: Settings, perm: 'cadastros' },
  { href: '/pessoas', label: 'Gerenciamento de ponto', icon: Users, perm: 'ponto_gerencial' },
  {
    label: 'Configurações', icon: Settings,
    children: [
      { href: '/producao-config', label: 'Produção & KDS', icon: Flame, perm: 'producao_kds' },
      { href: '/wizard', label: 'Config. por ramo', icon: Wand2, perm: 'config_ramo' },
      { href: '/planos', label: 'Planos & assinatura', icon: CreditCard, perm: 'planos' },
      { href: '/config/acessos', label: 'Acessos & perfis', icon: ShieldCheck, perm: 'acessos' },
      { href: '/servidor', label: 'Servidor local', icon: HardDrive, perm: 'servidor' },
    ],
  },
  {
    label: 'Relatórios', icon: BarChart3,
    children: [
      { href: '/caixa/fechamentos', label: 'Turnos', icon: Wallet, perm: 'turnos' },
      { href: '/relatorios', label: 'Relatórios de vendas', icon: BarChart3, perm: 'relatorios_vendas' },
      { href: '/vendas/remocoes', label: 'Cancelamentos de itens', icon: FileText, perm: 'cancelamentos' },
    ],
  },
  { href: '/auditoria', label: 'Auditoria', icon: History, perm: 'auditoria' },
  { href: '/diretoria', label: 'Visão C&O', icon: Building2, perm: 'visao_co' },
];

// Visibilidade por permissão: presidente vê tudo; senão checa o toggle do catálogo
// (para chaves CRUD como `estoque`, considera o `.ver`).
function temPerm(perm: string | undefined, perms: any, isPres: boolean): boolean {
  if (!perm) return true;
  if (isPres) return true;
  const v = perms?.[perm];
  return v && typeof v === 'object' ? !!v.ver : !!v;
}

export function Shell({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const { prefs, set, toggleColapso } = useUiPrefs();
  const [open, setOpen] = useState(false); // drawer (mobile)
  const [rel, setRel] = useState('');
  const [cat, setCat] = useState('');
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({}); // acordeão do menu
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setCat(getCategoria() ?? '');
    const fmt = () =>
      setRel(
        new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    fmt();
    const t = setInterval(fmt, 30000);
    return () => clearInterval(t);
  }, [router]);

  // Atalho [ alterna o recolhimento (fora de campos de texto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable)
        return;
      e.preventDefault();
      toggleColapso();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleColapso]);

  // Drawer (mobile): Esc fecha + foco preso enquanto aberto.
  useEffect(() => {
    if (!open) return;
    const aside = asideRef.current;
    const foco = () =>
      aside?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    foco()?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !aside) return;
      const foca = Array.from(
        aside.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((n) => n.offsetParent !== null);
      if (foca.length === 0) return;
      const primeiro = foca[0];
      const ultimo = foca[foca.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function sair() {
    clearToken();
    router.replace('/entrar');
  }

  const colapsado = prefs.sidebar === 'collapsed';

  const burger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="shell-burger rounded-md border border-border bg-card p-2"
      aria-label="Abrir menu"
      aria-expanded={open ? 'true' : 'false'}
    >
      <Menu className="h-5 w-5" />
    </button>
  );

  return (
    <div
      className="shell app-light bg-background font-sans text-foreground"
      data-side={prefs.side}
      data-collapsed={colapsado}
      data-open={open}
    >
      <aside
        ref={asideRef}
        className="shell-aside flex flex-col bg-[#0F2230] text-[#DCE7EE]"
        aria-label="Navegação principal"
      >
        <div className="shell-brand flex items-center gap-2.5 border-b border-white/10 px-5 py-4">
          <RegemMark className="h-8 w-8 flex-none text-white" />
          <div className="shell-brand-text">
            <p className="font-display text-base font-extrabold tracking-wide text-white">
              Regem
            </p>
            <p className="text-[10px] uppercase tracking-[.14em] text-[#7A99AC]">
              Controle total
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5">
          {(() => {
            const perms = getPermissoes();
            const isPres = cat === 'presidente';
            const Item = (it: NavSub | NavNode, sub?: boolean) => {
              const href = (it as NavSub).href;
              const active = path === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  title={it.label}
                  aria-label={it.label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'shell-navlink mb-0.5 flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors',
                    sub ? 'px-3 pl-9' : 'px-3',
                    active
                      ? 'bg-primary/25 text-white shadow-[inset_2px_0_0_hsl(var(--primary))]'
                      : 'text-[#B9CBD7] hover:bg-white/5 hover:text-white',
                  )}
                >
                  <it.icon className="h-4 w-4 flex-none" />
                  <span className="shell-label truncate">{it.label}</span>
                </Link>
              );
            };
            return NAV.map((node) => {
              // Folha: link direto.
              if (node.href) {
                return temPerm(node.perm, perms, isPres) ? Item(node) : null;
              }
              // Grupo: acordeão (clica no pai → expande/recolhe a lista).
              const kids = (node.children ?? []).filter((c) => temPerm(c.perm, perms, isPres));
              if (kids.length === 0) return null;
              const temAtivo = kids.some((c) => c.href === path);
              const aberto = gruposAbertos[node.label] ?? temAtivo; // abre sozinho na tela ativa
              return (
                <div key={node.label}>
                  <button
                    type="button"
                    aria-expanded={aberto}
                    onClick={() => setGruposAbertos((s) => ({ ...s, [node.label]: !aberto }))}
                    className={cn(
                      'shell-navlink mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      temAtivo
                        ? 'text-white'
                        : 'text-[#B9CBD7] hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <node.icon className="h-4 w-4 flex-none" />
                    <span className="shell-label flex-1 truncate text-left">{node.label}</span>
                    <ChevronDown
                      className={cn(
                        'shell-label h-4 w-4 flex-none transition-transform',
                        aberto ? '' : '-rotate-90',
                      )}
                    />
                  </button>
                  {aberto && kids.map((c) => Item(c, true))}
                </div>
              );
            });
          })()}
        </nav>

        <button
          type="button"
          onClick={toggleColapso}
          aria-expanded={colapsado ? 'false' : 'true'}
          aria-label={colapsado ? 'Expandir menu' : 'Recolher menu'}
          title={colapsado ? 'Expandir menu ([)' : 'Recolher menu ([)'}
          className="shell-collapse-btn mx-2.5 items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[#7A99AC] hover:bg-white/5 hover:text-white"
        >
          {colapsado ? (
            <PanelLeftOpen className="h-4 w-4 flex-none" />
          ) : (
            <PanelLeftClose className="h-4 w-4 flex-none" />
          )}
          <span className="shell-label">Recolher</span>
        </button>

        <AccountMenu cat={cat} prefs={prefs} onSet={set} onSair={sair} />
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40"
        />
      )}

      <div className="shell-content min-w-0">
        <LicencaAviso />
        <ServidorOfflineAviso />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-3.5">
          {prefs.side === 'left' && burger}
          <div>
            {eyebrow && (
              <p className="font-display text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                {eyebrow}
              </p>
            )}
            <h1 className="font-display text-xl font-extrabold tracking-tight">
              {title}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <ModoOperacao />
            <span className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-muted-foreground sm:inline-flex">
              <Clock className="h-3.5 w-3.5" /> {rel}
            </span>
            {actions}
            {prefs.side === 'right' && burger}
          </div>
        </div>
        <main className="px-5 py-5 pb-16">{children}</main>
      </div>

      {/* Navegação-topo no rodapé (Material 3) — só no mobile (<860px);
          no desktop a sidebar/drawer cobre a navegação. */}
      <BottomNav />
    </div>
  );
}
