import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { REQUIRE_PERM } from '../../auth/require-perm.decorator';
import { MODULO_KEY } from '../../auth/require-modulo.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { CATALOGO_PERMISSOES, PACOTE_SUPORTE, PACOTE_SUPORTE_TOTAL, perfilPadrao } from '../../auth/permissoes';
import { MODULOS } from '../modulo/modulo.service';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { VagasController, VagasPublicoController } from './vagas.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ROTAS DE VAGAS (mig 389): as públicas e as da loja são só da nuvem; as da loja exigem login, a permissão
// `candidatos` e o módulo "vagas" ligado (no servidor — RBAC nunca só na tela); apagar e mexer na página, gerente e
// presidente; o envio da ficha tem limite curto por IP.
describe('as rotas de vagas e candidatos', () => {
  const rota = (nome: string) => (VagasController.prototype as any)[nome];
  const publica = (nome: string) => (VagasPublicoController.prototype as any)[nome];

  it('só na nuvem, nas duas classes', () => {
    expect(Reflect.getMetadata(CLOUD_ONLY, VagasPublicoController)).toBe(true);
    expect(Reflect.getMetadata(CLOUD_ONLY, VagasController)).toBe(true);
    expect(CLOUD_ONLY_MODULES).toContain('VagasModule');
  });

  it('a loja: login, perfil, permissão e módulo em toda rota', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, VagasController)).toEqual([JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard]);
    expect(Reflect.getMetadata(REQUIRE_PERM, VagasController)).toEqual({ modulo: 'candidatos' });
    expect(Reflect.getMetadata(MODULO_KEY, VagasController)).toBe('vagas');
    for (const nome of ['apagar', 'salvarPagina', 'criarQr', 'apagarQr'])
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toEqual(['presidente', 'gerente']);
    for (const nome of ['lista', 'ficha', 'situacao', 'anotacao', 'entrevista', 'pagina', 'qrs', 'distancia'])
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toBeUndefined();
    // F2: "Medir de novo" chama o Nominatim e o OSRM — limite por minuto
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', rota('distancia'))).toBe(10);
  });

  it('a pública: sem login e com limite por IP (o envio é o mais curto)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, VagasPublicoController)).toBeUndefined();
    const limite = (nome: string) => Reflect.getMetadata('THROTTLER:LIMITdefault', publica(nome));
    expect(limite('ficha')).toBe(10);
    expect(limite('pagina')).toBe(60);
  });

  it('a permissão nasce para gerente e presidente, não para supervisão, execução nem o suporte mínimo', () => {
    expect(CATALOGO_PERMISSOES.find((c) => c.chave === 'candidatos')).toMatchObject({ grupo: 'Gestão', tipo: 'bool' });
    expect(perfilPadrao('presidente').permissoes.candidatos).toBe(true);
    expect(perfilPadrao('gerente').permissoes.candidatos).toBe(true);
    expect(perfilPadrao('supervisao').permissoes.candidatos).toBeFalsy();
    expect(perfilPadrao('execucao').permissoes.candidatos).toBeFalsy();
    expect(PACOTE_SUPORTE.candidatos).toBe(false);
    expect(PACOTE_SUPORTE_TOTAL.candidatos).toBe(true);
    expect(MODULOS.find((m) => m.chave === 'vagas')).toBeTruthy();
  });
});
