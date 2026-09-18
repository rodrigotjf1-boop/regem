import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Reflector } from '@nestjs/core';
import { NIVEIS, OperadorDeCaixa, ehGestor } from './niveis';
import { RolesGuard } from './roles.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Varredura do código-fonte: impede que voltem os erros do registro interno (set/2026):
//  • @Roles com nível que não existe ('atendente') — 14 rotas davam 403 ao operador de caixa;
//  • trava testando `=== 'atendente'` — supervisão/execução cancelavam venda sem liberação;
//  • `EDGE_MODE === '1'` — o instalador grava 'true'; a proteção nunca disparava na loja.
const SRC = join(__dirname, '..');
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}
// Só CÓDIGO: comentários explicam o erro citando o padrão proibido e não contam.
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const fontes = arquivos(SRC).map((p) => ({ p: relative(SRC, p), s: semComentarios(readFileSync(p, 'utf8')) }));

describe('níveis de acesso', () => {
  it('todo @Roles usa só níveis que existem', () => {
    const validos = new Set<string>(NIVEIS);
    const ruins: string[] = [];
    for (const { p, s } of fontes) {
      for (const m of s.matchAll(/@Roles\(([^)]*)\)/g)) {
        for (const v of m[1].matchAll(/'([^']+)'/g)) if (!validos.has(v[1])) ruins.push(`${p}: '${v[1]}'`);
      }
    }
    expect(ruins).toEqual([]);
  });

  it("nenhuma trava compara o perfil com um nível que não existe", () => {
    const ruins = fontes
      .filter(({ s }) => /(?:atorPerfil|categoria|perfil)\s*[!=]==?\s*'(atendente|caixa|garcom|operador)'/.test(s))
      .map(({ p }) => p);
    expect(ruins).toEqual([]);
  });

  it("ninguém testa EDGE_MODE contra '1' (o instalador grava 'true' — use ehServidorLocal())", () => {
    const ruins = fontes.filter(({ s }) => /EDGE_MODE\s*[!=]==?\s*['"]1['"]/.test(s)).map(({ p }) => p);
    expect(ruins).toEqual([]);
  });

  it('ehGestor: presidente, gerente e suporte; supervisão e execução não', () => {
    expect(['presidente', 'gerente', 'suporte'].every(ehGestor)).toBe(true);
    expect(['supervisao', 'execucao', 'atendente', undefined].some((c) => ehGestor(c as any))).toBe(false);
  });
});

describe('@OperadorDeCaixa no RolesGuard', () => {
  class Ctl {
    @OperadorDeCaixa()
    abrir() {}
  }
  const guard = new RolesGuard(new Reflector());
  const ctx = (user: any) =>
    ({
      getHandler: () => Ctl.prototype.abrir,
      getClass: () => Ctl,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('execução COM permissão de PDV entra (antes: 403 — "atendente" não existe)', () => {
    expect(guard.canActivate(ctx({ categoria: 'execucao', permissoes: { pdv: true } }))).toBe(true);
  });
  it('execução SEM permissão de PDV fica de fora', () => {
    expect(() => guard.canActivate(ctx({ categoria: 'execucao', permissoes: { pdv: false } }))).toThrow(/caixa/);
  });
  it('gerente entra mesmo sem a permissão no pacote (não tira acesso de ninguém)', () => {
    expect(guard.canActivate(ctx({ categoria: 'gerente', permissoes: {} }))).toBe(true);
  });
});
