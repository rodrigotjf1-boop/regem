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
  ClipboardList,
  Clock,
  Coins,
  ConciergeBell,
  CreditCard,
  ReceiptText,
  FileText,
  Flame,
  History,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Bot,
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
import { useUiPrefs } from '@/hooks/use-ui-prefs';
import { AccountMenu } from './account-menu';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
  perm?: string; // permissão do perfil exigida para ver o item (ex.: 'fiscal')
};
type NavGroup = { group: string; presidenteOnly: boolean; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    group: 'Operação',
    presidenteOnly: false,
    items: [
      { href: '/painel', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/pdv', label: 'PDV · Balcão', icon: ShoppingCart },
      { href: '/mesas', label: 'Mesas e comandas', icon: ClipboardList },
      { href: '/garcom', label: 'Garçom', icon: ConciergeBell },
      { href: '/pedidos', label: 'Pedidos · Produção', icon: Flame },
      { href: '/delivery', label: 'Delivery', icon: Bike },
      { href: '/cupons', label: 'Cupons', icon: ReceiptText },
      { href: '/meu-dia', label: 'Meu Dia', icon: ListChecks },
      { href: '/escala', label: 'Escalas', icon: CalendarDays },
      { href: '/operacao', label: 'Estoque', icon: Boxes },
      { href: '/docs', label: 'Documentos', icon: FileText },
      { href: '/mural', label: 'Mural & Clima', icon: Megaphone },
    ],
  },
  {
    group: 'Fiscal',
    presidenteOnly: false,
    items: [
      // Notas fiscais (NFC-e) = gestão fiscal → permissão "fiscal" do perfil.
      // TEF/maquininha fica na operação de balcão.
      { href: '/notas', label: 'Notas fiscais', icon: FileText, perm: 'fiscal' },
      { href: '/tef', label: 'TEF / Maquininha', icon: CreditCard },
      {
        href: '/fiscal-config',
        label: 'Configuração',
        icon: Coins,
        roles: ['presidente'],
      },
    ],
  },
  {
    group: 'Gestão',
    presidenteOnly: false,
    items: [
      { href: '/cadastros', label: 'Cadastros', icon: Settings },
      {
        href: '/pessoas',
        label: 'Pessoas & Ponto',
        icon: Users,
        roles: ['presidente', 'gerente', 'supervisao'],
      },
      {
        href: '/producao-config',
        label: 'Produção & KDS',
        icon: Flame,
        roles: ['presidente', 'gerente', 'supervisao'],
      },
      {
        href: '/financeiro',
        label: 'Financeiro',
        icon: Wallet,
        roles: ['presidente', 'gerente'],
      },
      {
        href: '/relatorios',
        label: 'Relatórios de venda',
        icon: BarChart3,
        roles: ['presidente', 'gerente', 'supervisao'],
      },
      {
        href: '/auditoria',
        label: 'Auditoria',
        icon: History,
        roles: ['presidente', 'gerente'],
      },
      {
        href: '/bot',
        label: 'Bot de Suporte',
        icon: Bot,
        roles: ['presidente', 'gerente'],
      },
      {
        href: '/wizard',
        label: 'Config. por ramo',
        icon: Wand2,
        roles: ['presidente', 'gerente'],
      },
      {
        href: '/config/acessos',
        label: 'Acessos & perfis',
        icon: ShieldCheck,
        roles: ['presidente'],
      },
    ],
  },
  {
    group: 'Diretoria',
    presidenteOnly: true,
    items: [{ href: '/diretoria', label: 'Visão C&O', icon: Building2 }],
  },
];

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
          {NAV.filter((g) => !g.presidenteOnly || cat === 'presidente').map((g) => (
            <div key={g.group}>
              <p className="shell-group-label px-3 pb-1.5 pt-3.5 font-display text-[10px] font-bold uppercase tracking-[.16em] text-[#5E7B8E]">
                {g.group}
              </p>
              {g.items
                .filter((it) => !it.roles || it.roles.includes(cat))
                .filter((it) => !it.perm || !!getPermissoes()?.[it.perm])
                .map((it) => {
                  const active = path === it.href;
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      onClick={() => setOpen(false)}
                      title={it.label}
                      aria-label={it.label}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'shell-navlink mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/25 text-white shadow-[inset_2px_0_0_hsl(var(--primary))]'
                          : 'text-[#B9CBD7] hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <it.icon className="h-4 w-4 flex-none" />
                      <span className="shell-label truncate">{it.label}</span>
                    </Link>
                  );
                })}
            </div>
          ))}
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
