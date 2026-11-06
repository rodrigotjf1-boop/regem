import { PartialType } from '@nestjs/swagger';
import { CreateProdutoDto } from './create-produto.dto';

/**
 * A EDIÇÃO do produto (`PATCH /produtos/:id`) é PARCIAL: só o que veio muda (o serviço já pula o ausente). Antes o
 * PATCH validava com o DTO de CRIAÇÃO — nome e preço obrigatórios — e recusava (400) toda edição de um campo só: o
 * "Ocultar/Retomar" da lista do Cardápio (desde o #234, 28/07/2026) e a tela de Catálogo. O que vem continua conferido
 * (nome vazio, preço que não é número: recusados).
 */
export class UpdateProdutoDto extends PartialType(CreateProdutoDto) {}
