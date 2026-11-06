import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { ProdutoController } from './produto.controller';

// A EDIÇÃO do produto é PARCIAL (`PATCH /produtos/:id`). Defeito de 28/07/2026 (#234) a 06/11/2026: o PATCH validava
// com o DTO de CRIAÇÃO (nome e preço obrigatórios), e o "Ocultar/Retomar" da lista do Cardápio — que manda só
// `disponivelBalcao`/`disponivelCardapio` — e a tela de Catálogo — que manda o campo mudado — eram recusados (400:
// "nome must be longer than or equal to 1 characters; …; precoVenda must be a number…"). Achado pelo dono ao testar o
// piloto do iFood pelo Orzuni. O teste passa o corpo pelo MESMO ValidationPipe da API (`main.ts`).

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const validar = (dto: any, body: unknown) => pipe.transform(body, { type: 'body', metatype: dto });

describe('edição parcial do produto (PATCH /produtos/:id)', () => {
  it('o corpo do "Ocultar/Retomar" (dois campos) passa, sem nome nem preço', async () => {
    const r: any = await validar(UpdateProdutoDto, { disponivelBalcao: false, disponivelCardapio: false });
    expect(r).toEqual({ disponivelBalcao: false, disponivelCardapio: false });
    expect(r.nome).toBeUndefined(); // ausente = o serviço não mexe
  });

  it('o corpo da tela de Catálogo (um campo) passa', async () => {
    expect(await validar(UpdateProdutoDto, { precoVenda: 33 })).toEqual({ precoVenda: 33 });
    expect(await validar(UpdateProdutoDto, { canaisPausados: ['ifood'] })).toEqual({ canaisPausados: ['ifood'] });
  });

  it('o que vem continua conferido: nome vazio, preço que não é número e liga/desliga que não é booleano são recusados', async () => {
    await expect(validar(UpdateProdutoDto, { nome: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar(UpdateProdutoDto, { precoVenda: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar(UpdateProdutoDto, { disponivelBalcao: 'nao' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('campo desconhecido não passa adiante (whitelist)', async () => {
    expect(await validar(UpdateProdutoDto, { disponivelBalcao: true, tenantId: 'de-outro' })).toEqual({ disponivelBalcao: true });
  });

  it('a rota PATCH /produtos/:id valida com o DTO de EDIÇÃO (o que o ValidationPipe recebe como metatype)', () => {
    const tipos = Reflect.getMetadata('design:paramtypes', ProdutoController.prototype, 'atualizar') as unknown[];
    expect(tipos[2]).toBe(UpdateProdutoDto);
  });

  it('o defeito: com o DTO de criação, o corpo do "Ocultar" era recusado', async () => {
    await expect(validar(CreateProdutoDto, { disponivelBalcao: false, disponivelCardapio: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
