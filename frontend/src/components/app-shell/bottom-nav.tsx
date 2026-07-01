'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, FileText, ListChecks, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/meu-dia', label: 'Meu Dia', icon: ListChecks },
  { href: '/escala', label: 'Escala', icon: CalendarDays },
  { href: '/docs', label: 'Docs', icon: FileText },
  { href: '/cadastros', label: 'Cadastros', icon: Settings },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors',
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
