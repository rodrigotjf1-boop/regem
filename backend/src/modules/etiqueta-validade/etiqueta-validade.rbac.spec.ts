import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { CATALOGO_PERMISSOES, PERFIS_PADRAO } from '../../auth/permissoes';
import { EtiquetaValidadeController } from './etiqueta-validade.controller';
import { DesperdicioController } from '../desperdicio/desperdicio.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Matriz de acesso do REGISTRO DE DESPERDÍCIO e do PONTO DE BAIXA, com os guards REAIS
// contra os handlers REAIS, perfil por perfil (perfis padrão de `permissoes.ts`).
//
// Decisão do dono: registra quem é de GESTÃO e tem a permissão `desperdicio`. A execução
// NÃO vem com ela, mas o presidente pode habilitá-la num perfil de execução. Template,
// fontes, listagem e criação de etiqueta seguem só com a gestão.
//
// O teste também trava a FORMA: uma permissão declarada na CLASSE não tem como ser
// anulada num método, então quem subir os decorators de volta para a classe quebra aqui.
describe('RBAC — desperdício e ponto de baixa', () => {
  const reflector = new Reflector();
  const roles = new RolesGuard(reflector);
  const perms = new PermissoesGuard(reflector);

  const padrao = (nivel: string) =>
    PERFIS_PADRAO.find((x: any) => x.nivel === nivel)!.permissoes as any;

  const pode = (classe: any, metodo: string, nivel: string, permissoes?: any): boolean => {
    const user = { tenantId: 't', colaboradorId: 'c', categoria: nivel, permissoes: permissoes ?? padrao(nivel) };
    const ctx = {
      getHandler: () => classe.prototype[metodo],
      getClass: () => classe,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    try {
      return roles.canActivate(ctx) && perms.canActivate(ctx);
    } catch {
      return false;
    }
  };

  const PONTO = ['buscar', 'ler', 'abrir', 'finalizar', 'perda'];
  const GESTAO_ETIQUETA = ['template', 'salvarTemplate', 'fontes', 'listar', 'criar'];

  it('a permissão está no catálogo — é o que põe o interruptor em Acessos & Perfis', () => {
    expect(CATALOGO_PERMISSOES.some((c: any) => c.chave === 'desperdicio' && c.tipo === 'bool')).toBe(true);
  });

  describe('padrão dos níveis', () => {
    it('gestão vem COM a permissão', () => {
      expect(padrao('gerente').desperdicio).toBe(true);
      expect(padrao('supervisao').desperdicio).toBe(true);
    });
    it('execução vem SEM a permissão', () => {
      expect(padrao('execucao').desperdicio).toBeFalsy();
    });
  });

  describe('execução com o perfil PADRÃO', () => {
    it.each(PONTO)('NÃO opera o ponto de baixa: %s', (m) => {
      expect(pode(EtiquetaValidadeController, m, 'execucao')).toBe(false);
    });
    it('NÃO registra desperdício', () => {
      expect(pode(DesperdicioController, 'create', 'execucao')).toBe(false);
    });
  });

  describe('execução com a permissão LIBERADA pelo presidente', () => {
    const liberado = () => ({ ...padrao('execucao'), desperdicio: true });

    it.each(PONTO)('opera o ponto de baixa: %s', (m) => {
      expect(pode(EtiquetaValidadeController, m, 'execucao', liberado())).toBe(true);
    });
    it('registra desperdício', () => {
      expect(pode(DesperdicioController, 'create', 'execucao', liberado())).toBe(true);
    });
    // Liberar o registro não abre o resto: a gestão de etiquetas e o relatório de
    // desperdício (com custo) continuam fora.
    it.each(GESTAO_ETIQUETA)('continua SEM a gestão de etiquetas: %s', (m) => {
      expect(pode(EtiquetaValidadeController, m, 'execucao', liberado())).toBe(false);
    });
    it('continua sem listar os desperdícios', () => {
      expect(pode(DesperdicioController, 'findAll', 'execucao', liberado())).toBe(false);
    });
  });

  describe('gestão', () => {
    it.each(['gerente', 'supervisao'])('%s padrão registra e opera o ponto de baixa', (nivel) => {
      for (const m of [...PONTO, 'template', 'fontes', 'listar'])
        expect(pode(EtiquetaValidadeController, m, nivel)).toBe(true);
      expect(pode(DesperdicioController, 'create', nivel)).toBe(true);
      expect(pode(DesperdicioController, 'findAll', nivel)).toBe(true);
    });

    // O presidente desligou a permissão num perfil de gestão → vale o desligado.
    it('gerente com a permissão DESLIGADA não registra', () => {
      const semPerm = { ...padrao('gerente'), desperdicio: false };
      expect(pode(DesperdicioController, 'create', 'gerente', semPerm)).toBe(false);
      for (const m of PONTO) expect(pode(EtiquetaValidadeController, m, 'gerente', semPerm)).toBe(false);
    });
  });

  it('presidente passa em tudo', () => {
    for (const m of [...PONTO, ...GESTAO_ETIQUETA])
      expect(pode(EtiquetaValidadeController, m, 'presidente')).toBe(true);
    expect(pode(DesperdicioController, 'create', 'presidente')).toBe(true);
  });
});
