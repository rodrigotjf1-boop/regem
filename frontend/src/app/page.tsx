import Link from 'next/link';
import { RegemMark } from '@/components/brand/regem-mark';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Landing pública (antes do login). Tema navy padrão + dourado Regem.
// Referência visual: mockups Omera brand-kit — bloco "Topo de landing page".
export default function LandingPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* Órbita decorativa de fundo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid place-items-center"
      >
        <svg
          viewBox="0 0 800 800"
          className="h-auto w-[min(1100px,160vw)] text-primary opacity-[0.10] motion-safe:animate-[spin_60s_linear_infinite] [transform-origin:center]"
          fill="none"
          stroke="currentColor"
        >
          <circle cx="400" cy="400" r="230" strokeWidth="1.5" />
          <circle
            cx="400"
            cy="400"
            r="320"
            strokeWidth="1.5"
            strokeDasharray="2 14"
          />
          <circle cx="400" cy="400" r="150" strokeWidth="1.5" />
          <circle cx="628" cy="330" r="9" fill="currentColor" stroke="none" />
          <circle cx="205" cy="470" r="6" fill="currentColor" stroke="none" />
        </svg>
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-6">
        {/* Barra superior */}
        <header className="flex items-center gap-3 py-5">
          <Link href="/" className="flex items-center gap-3">
            <RegemMark className="h-7 w-7 text-foreground" />
            <span className="font-display text-lg font-semibold tracking-tight">
              Regem
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
            <a href="#produto" className="transition-colors hover:text-foreground">
              Produto
            </a>
            <a href="#ramos" className="transition-colors hover:text-foreground">
              Ramos
            </a>
            <a href="#precos" className="transition-colors hover:text-foreground">
              Preços
            </a>
          </nav>
          <Link
            href="/entrar"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'ml-auto rounded-full sm:ml-6',
            )}
          >
            Entrar
          </Link>
          <Link
            href="/criar-conta"
            className={cn(
              buttonVariants({ size: 'sm' }),
              'hidden rounded-full sm:inline-flex',
            )}
          >
            Testar grátis
          </Link>
        </header>

        {/* Hero */}
        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center sm:py-24">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">
            Bares · Restaurantes · e o que vier depois
          </p>
          <h1 className="mt-5 max-w-[18ch] font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Controle <span className="text-primary">total</span> do seu negócio,
            de ponta a ponta.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            Vendas, estoque, equipe e financeiro numa só plataforma. Simples no
            balcão, completa na diretoria.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href="/criar-conta"
              className={cn(buttonVariants({ size: 'lg' }), 'rounded-full')}
            >
              Começar agora
            </Link>
            <Link
              href="/entrar"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'rounded-full',
              )}
            >
              Ver demonstração
            </Link>
          </div>
        </section>

        {/* Rodapé */}
        <footer className="py-10 text-center">
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
            Regem · No comando de todo o negócio · do balcão ao balanço
          </p>
        </footer>
      </div>
    </main>
  );
}
