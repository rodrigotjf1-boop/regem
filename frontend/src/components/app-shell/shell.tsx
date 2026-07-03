'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Boxes,
  Building2,
  CalendarDays,
  ChefHat,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  type LucideIcon,
  Menu,
  ScrollText,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import { clearToken, getCategoria, getToken } from '@/lib/api';
import { RegemMark } from '@/components/brand/regem-mark';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
};
type NavGroup = { group: string; presidenteOnly: boolean; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    group: 'Operação',
    presidenteOnly: false,
    items: [
      { href: '/painel', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/meu-dia', label: 'Meu Dia', icon: ListChecks },
      { href: '/escala', label: 'Escalas', icon: CalendarDays },
      { href: '/operacao', label: 'Operação', icon: Boxes },
      { href: '/fichas', label: 'Fichas Técnicas', icon: ChefHat },
      { href: '/guias', label: 'POP & Guias', icon: ScrollText },
      { href: '/docs', label: 'Documentos', icon: FileText },
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
        href: '/financeiro',
        label: 'Financeiro',
        icon: Wallet,
        roles: ['presidente', 'gerente'],
      },
      {
        href: '/auditoria',
        label: 'Auditoria',
        icon: History,
        roles: ['presidente', 'gerente'],
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
  const [open, setOpen] = useState(false);
  const [rel, setRel] = useState('');
  const [cat, setCat] = useState('');

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

  function sair() {
    clearToken();
    router.replace('/entrar');
  }

  return (
    <div className="app-light min-h-dvh bg-background font-sans text-foreground md:grid md:grid-cols-[236px_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col bg-[#0F2230] text-[#DCE7EE] transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-4">
          <RegemMark className="h-8 w-8 text-white" />
          <div>
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
              <p className="px-3 pb-1.5 pt-3.5 font-display text-[10px] font-bold uppercase tracking-[.16em] text-[#5E7B8E]">
                {g.group}
              </p>
              {g.items
                .filter((it) => !it.roles || it.roles.includes(cat))
                .map((it) => {
                const active = path === it.href;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/25 text-white shadow-[inset_2px_0_0_hsl(var(--primary))]'
                        : 'text-[#B9CBD7] hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <it.icon className="h-4 w-4" />
                    {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="m-2.5 flex items-center gap-2.5 rounded-lg bg-white/5 p-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary">
            <RegemMark className="h-5 w-5 text-[#0F2230]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">
              Minha conta
            </p>
            <p className="text-[11px] uppercase tracking-wide text-[#7A99AC]">
              {cat || '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={sair}
            aria-label="Sair"
            className="text-[#7A99AC] hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <div className="min-w-0">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-border bg-card p-2 md:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
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
          </div>
        </div>
        <main className="px-5 py-5 pb-16">{children}</main>
      </div>
    </div>
  );
}
