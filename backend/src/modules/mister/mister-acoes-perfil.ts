import { pode, podeAcessar, type Permissoes } from '../../auth/permissoes';
import { ACOES, TEXTOS_DAS_ACOES, type AcaoDoMister, type DefinicaoDaAcao } from './mister-acoes';
import { MOTIVO_DO_PIN, motivoDoPerfil, type MotivoDaFerramenta } from './mister-motivo';

// A CONFERÊNCIA DO PERFIL das ações do Mister (o que a rota da tela pede), pura: o serviço das ações (`preparar`) e a avaliação
// usam a MESMA. Versão 10, C6: a recusa volta com o motivo e os caminhos (`mister-motivo.ts`).

/** De quem pede, só o que a conferência usa. */
export interface PerfilDaAcao {
  nivel: string;
  presa?: string | null;
  verValores: boolean;
  permissoes?: Permissoes | null;
}

/** A frase de quem não tem a permissão da ação (a mesma da rota da tela). */
export const semPermissaoDe = (p: DefinicaoDaAcao['permissao']) =>
  p === 'financeiro'
    ? TEXTOS_DAS_ACOES.semPermissaoConta
    : p === 'estoque'
    ? TEXTOS_DAS_ACOES.semPermissaoEstoque
    : p === 'cupons'
    ? TEXTOS_DAS_ACOES.semPermissaoCupons
    : p === 'cadastros'
    ? TEXTOS_DAS_ACOES.semPermissaoCadastros
    : p === 'escalas'
    ? TEXTOS_DAS_ACOES.semPermissaoEscalas
    : p === 'pdv'
    ? TEXTOS_DAS_ACOES.semPermissaoCaixa
    : p === 'ponto'
    ? TEXTOS_DAS_ACOES.semPermissaoPonto
    : p === 'meu_dia'
    ? TEXTOS_DAS_ACOES.semPermissaoTarefas
    : p === 'loja'
      ? TEXTOS_DAS_ACOES.semPermissaoLoja
      : p === 'checklist'
        ? TEXTOS_DAS_ACOES.semPermissaoChecklist
        : TEXTOS_DAS_ACOES.semPermissao;

/** A MESMA conta do `PermissoesGuard`: o estoque e a escala são CRUD (as rotas pedem `criar`/`editar`), os outros são chaves simples. */
const temAPermissao = (perm: Permissoes | undefined | null, p: DefinicaoDaAcao['permissao'], crud: DefinicaoDaAcao['crud'] = 'editar') =>
  // As chaves com ações (ver, criar, editar, excluir) conferem a ação da rota; as outras, o acesso. O ponto entrou na etapa 5
  // (24/11): incluir pede ponto.criar e desconsiderar, ponto.editar — sem isso, quem só vê o ponto ajustava pela conversa.
  p === 'estoque' || p === 'escalas' || p === 'ponto' ? pode(perm, p, crud ?? 'editar') : podeAcessar(perm, p);

/** A permissão da ação: a da rota e, no preço, "Ver valores em R$" (o `exigirVerValores` da rota). O presidente pode tudo. */
export const podeFazer = (e: { nivel: string; permissoes?: Permissoes | null }, def: (typeof ACOES)[AcaoDoMister]) =>
  e.nivel === 'presidente' || (temAPermissao(e.permissoes, def.permissao, def.crud) && (!def.pedeVerValores || !!e.permissoes?.ver_financeiro));

/** Quem pode, dito na recusa: o presidente, ou o gerente com a permissão da tela. */
const QUEM_PODE_PELA_PERMISSAO = 'o presidente, ou um gerente com essa permissão no perfil';

/**
 * A recusa pelo perfil, na ordem da conferência de sempre — ou null quando o perfil faz. O dado da empresa inteira (saldo,
 * folha, custo de campanha) é do presidente da empresa inteira; o dinheiro pede o PIN da sessão em dia; Banco e repasses é só
 * do presidente, como a rota (V8-2).
 */
export function recusaPeloPerfil(e: PerfilDaAcao, acao: AcaoDoMister): { erro: string; motivo: MotivoDaFerramenta } | null {
  const def = ACOES[acao];
  if (def.soPresidente && e.nivel !== 'presidente') return { erro: TEXTOS_DAS_ACOES.dadoSoPresidente, motivo: motivoDoPerfil('o presidente') };
  if (def.soPresidente && e.presa) return { erro: TEXTOS_DAS_ACOES.dadoEmpresaInteira, motivo: motivoDoPerfil('o presidente da empresa inteira') };
  if (def.soPresidente && !e.verValores) return { erro: TEXTOS_DAS_ACOES.dadoPedePin, motivo: MOTIVO_DO_PIN };
  if (!podeFazer(e, def)) {
    const erro =
      def.id === 'mudar_horario'
        ? TEXTOS_DAS_ACOES.semPermissaoHorario
        : def.id === 'mudar_preco'
          ? TEXTOS_DAS_ACOES.semPermissaoPreco
          : def.id === 'lancar_conta'
            ? TEXTOS_DAS_ACOES.semPermissaoLancarConta
            : semPermissaoDe(def.permissao);
    return { erro, motivo: motivoDoPerfil(QUEM_PODE_PELA_PERMISSAO) };
  }
  // Lote 10: quem autoriza dinheiro VÊ o valor. Com o PIN da sessão vencido, o link da sessão vai depois desta resposta.
  if ((acao === 'pagar_conta' || acao === 'lancar_conta' || acao === 'classificar_banco') && !e.verValores) return { erro: TEXTOS_DAS_ACOES.contaPedePin, motivo: MOTIVO_DO_PIN };
  if (acao === 'classificar_banco' && e.nivel !== 'presidente') return { erro: TEXTOS_DAS_ACOES.bancoSoPresidente, motivo: motivoDoPerfil('o presidente') };
  return null;
}
