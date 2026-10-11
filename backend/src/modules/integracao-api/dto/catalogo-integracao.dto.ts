import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Formato das rotas de CATÁLOGO e FICHAS da API de integração (Farol — mig 315) — só para o
// contrato OpenAPI (`docs/openapi.json`). O contrato em palavras está em `docs/integracao-farol.md`.
// Nenhum campo aqui é de dinheiro: preço, custo, margem e CMV não saem por estas rotas.

export class CategoriaCatalogoIntegracao {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ nullable: true, type: String, description: 'A categoria de cima (null = categoria principal).' })
  categoria_pai_id!: string | null;

  @ApiProperty()
  ordem!: number;

  @ApiProperty()
  ativo!: boolean;
}

export class SetorCatalogoIntegracao {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nome!: string;
}

export class VariacaoCatalogoIntegracao {
  @ApiProperty({ description: 'Muda quando o produto é salvo de novo: case a variação pelo produto e pelo código (ou nome).' })
  id!: string;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ nullable: true, type: String })
  codigo!: string | null;

  @ApiProperty({ description: 'Quanto da ficha do produto esta variação usa (1 = a ficha inteira).' })
  fator_ficha!: number;

  @ApiProperty()
  ativo!: boolean;
}

export class ItemComboIntegracao {
  @ApiProperty({ description: 'O produto que faz parte do combo.' })
  produto_id!: string;

  @ApiProperty()
  quantidade!: number;
}

export class AcrescentaOpcaoIntegracao {
  @ApiProperty({ enum: ['insumo', 'ficha', 'produto'] })
  tipo!: string;

  @ApiPropertyOptional({ description: 'tipo insumo: o item do estoque.' })
  insumo_id?: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'tipo insumo: o nome do item.' })
  nome?: string | null;

  @ApiPropertyOptional({ description: 'tipo insumo: quanto sai a cada vez que a opção é escolhida, na unidade do estoque.' })
  quantidade_estoque?: number;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'tipo insumo: a unidade do estoque do item.' })
  unidade_estoque?: string | null;

  @ApiPropertyOptional({ description: 'tipo ficha: a ficha técnica da opção (uma porção por escolha).' })
  ficha_id?: string;

  @ApiPropertyOptional({ description: 'tipo produto: o produto que a opção é (a bebida do combo).' })
  produto_id?: string;
}

export class RetiraOpcaoIntegracao {
  @ApiProperty({ nullable: true, type: String, description: 'O item do estoque que deixa de entrar.' })
  insumo_id!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'A sub-receita que deixa de entrar.' })
  sub_ficha_id!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'O nome do ingrediente na ficha.' })
  nome!: string | null;
}

export class OpcaoAdicionalIntegracao {
  @ApiProperty({ description: 'O id que a venda grava. Muda quando o catálogo é salvo de novo.' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, description: 'O id FIXO da opção reutilizável (null = opção criada só neste produto).' })
  opcao_id!: string | null;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Código PDV.' })
  codigo!: string | null;

  @ApiProperty()
  ordem!: number;

  @ApiProperty({ description: 'Sem código PDV: é só uma observação ("ponto da carne") — não acrescenta nem retira nada.' })
  informativa!: boolean;

  @ApiProperty({ nullable: true, type: AcrescentaOpcaoIntegracao })
  acrescenta!: AcrescentaOpcaoIntegracao | null;

  @ApiProperty({ nullable: true, type: RetiraOpcaoIntegracao })
  retira!: RetiraOpcaoIntegracao | null;
}

export class AdicionalIntegracao {
  @ApiProperty({ description: 'Muda quando o catálogo é salvo de novo.' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, description: 'O id FIXO da etapa reutilizável (null = grupo criado só neste produto).' })
  etapa_id!: string | null;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ enum: ['adicionar', 'remover'] })
  tipo!: string;

  @ApiProperty()
  min!: number;

  @ApiProperty({ nullable: true, type: Number, description: 'null = sem limite.' })
  max!: number | null;

  @ApiProperty()
  obrigatorio!: boolean;

  @ApiProperty()
  ordem!: number;

  @ApiProperty({ type: [OpcaoAdicionalIntegracao] })
  opcoes!: OpcaoAdicionalIntegracao[];
}

export class ProdutoCatalogoIntegracao {
  @ApiProperty({ description: 'Id fixo do produto.' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Código PDV.' })
  codigo!: string | null;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ nullable: true, type: String })
  descricao!: string | null;

  @ApiProperty({ enum: ['simples', 'variavel', 'combo'] })
  tipo!: string;

  @ApiProperty({ nullable: true, type: String })
  unidade_medida!: string | null;

  @ApiProperty({ nullable: true, type: String })
  categoria_id!: string | null;

  @ApiProperty({ description: 'O produto passa pela cozinha (gera pedido de produção).' })
  vai_para_producao!: boolean;

  @ApiProperty({ nullable: true, type: String, description: 'O setor de produção do cadastro (pode ser de outra loja da empresa).' })
  setor_producao_id!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  tempo_preparo_min!: number | null;

  @ApiProperty({ nullable: true, type: String, description: 'A ficha técnica do produto (ver GET /integracao/fichas).' })
  ficha_id!: string | null;

  @ApiProperty()
  ativo!: boolean;

  @ApiProperty({ type: [VariacaoCatalogoIntegracao] })
  variacoes!: VariacaoCatalogoIntegracao[];

  @ApiProperty({ type: [ItemComboIntegracao] })
  combo!: ItemComboIntegracao[];

  @ApiProperty({ type: [AdicionalIntegracao] })
  adicionais!: AdicionalIntegracao[];
}

export class CatalogoIntegracao {
  @ApiProperty({ description: 'A impressão deste retrato (32 caracteres). Mande de volta em `?versao=`.' })
  versao!: string;

  @ApiProperty({ description: 'false = nada mudou desde a versão informada: os outros campos não vêm.' })
  atualizado!: boolean;

  @ApiPropertyOptional({ description: 'Quando o retrato foi montado (ISO 8601, UTC).' })
  gerado_em?: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'A loja do token.' })
  loja_id?: string | null;

  @ApiPropertyOptional({ type: [CategoriaCatalogoIntegracao] })
  categorias?: CategoriaCatalogoIntegracao[];

  @ApiPropertyOptional({ type: [SetorCatalogoIntegracao], description: 'Os setores da loja do token.' })
  setores?: SetorCatalogoIntegracao[];

  @ApiPropertyOptional({ type: [ProdutoCatalogoIntegracao] })
  produtos?: ProdutoCatalogoIntegracao[];
}

export class IngredienteFichaIntegracao {
  @ApiProperty()
  ordem!: number;

  @ApiProperty({ nullable: true, type: String, description: 'O item do estoque (null = sub-receita ou insumo escrito à mão).' })
  insumo_id!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'A outra ficha que entra como ingrediente (sub-receita).' })
  sub_ficha_id!: string | null;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ description: 'A quantidade como foi informada na ficha, na `unidade`.' })
  quantidade!: number;

  @ApiProperty({ nullable: true, type: String })
  unidade!: string | null;

  @ApiProperty({ description: 'A mesma quantidade na unidade do estoque do insumo (é a que a venda baixa).' })
  quantidade_estoque!: number;

  @ApiProperty({ nullable: true, type: String, description: 'A unidade do estoque do insumo (null = sem item do estoque).' })
  unidade_estoque!: string | null;

  @ApiProperty({ description: 'Fator de correção (perda no preparo): 1 = sem perda.' })
  fator_correcao!: number;

  @ApiProperty({ description: 'A linha só entra em pedido que sai da loja (a embalagem).' })
  so_delivery!: boolean;
}

export class FichaIntegracao {
  @ApiProperty({ description: 'Id fixo da ficha.' })
  id!: string;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ nullable: true, type: String })
  categoria!: string | null;

  @ApiProperty({ description: 'Quanto a ficha rende.' })
  rendimento!: number;

  @ApiProperty({ nullable: true, type: String })
  rendimento_unidade!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  porcao_tamanho!: number | null;

  @ApiProperty({ nullable: true, type: String })
  porcao_unidade!: string | null;

  @ApiProperty({ nullable: true, type: String })
  setor_id!: string | null;

  @ApiProperty()
  ativo!: boolean;

  @ApiProperty({ type: [IngredienteFichaIntegracao] })
  ingredientes!: IngredienteFichaIntegracao[];
}

export class FichasIntegracao {
  @ApiProperty({ description: 'A impressão deste retrato (32 caracteres). Mande de volta em `?versao=`.' })
  versao!: string;

  @ApiProperty({ description: 'false = nada mudou desde a versão informada: os outros campos não vêm.' })
  atualizado!: boolean;

  @ApiPropertyOptional({ description: 'Quando o retrato foi montado (ISO 8601, UTC).' })
  gerado_em?: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'A loja do token.' })
  loja_id?: string | null;

  @ApiPropertyOptional({ type: [FichaIntegracao] })
  fichas?: FichaIntegracao[];
}
