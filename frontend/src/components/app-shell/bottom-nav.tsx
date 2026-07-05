'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Boxes,
  CalendarDays,
  FileText,
  ListChecks,
  Settings,
} from 'lucide-react';
import { getCategoria } from '@/lib/api';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  icon: typeof ListChecks;
  roles?: string[]; // ausente = todos os perfis
};

const items: NavItem[] = [
  { href: '/meu-dia', label: 'Meu Dia', icon: ListChecks },
  { href: '/escala', label: 'Escala', icon: CalendarDays },
  { href: '/operacao', label: 'Operação', icon: Boxes },
  { href: '/docs', label: 'Docs', icon: FileText },
  // Execução não gerencia cadastros.
  { href: '/cadastros', label: 'Cadastros', icon: Settings, roles: ['presidente', 'gerente', 'supervisao'] },
];

export function BottomNav() {
  const path = usePathname();
  const [cat, setCat] = useState('');

  useEffect(() => {
    setCat(getCategoria() ?? '');
  }, []);

  const visiveis = items.filter((it) => !it.roles || it.roles.includes(cat));

  // Vibração tátil curta ao trocar de aba (Android). Não vibra ao retocar a atual.
  const tocar = (href: string) => {
    if (href !== path && typeof navigator !== 'undefined') {
      navigator.vibrate?.(10);
    }
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur min-[860px]:hidden">
      {/* respeita a home-bar do Android (viewportFit:cover da Fase 1) */}
      <div className="mx-auto flex max-w-2xl pb-[env(safe-area-inset-bottom)]">
        {visiveis.map(({ href, label, icon: Icon }) => {
          // Ativo na própria rota e em qualquer sub-rota (ex.: /operacao/estoque).
          const active = path === href || path.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              onClick={() => tocar(href)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
