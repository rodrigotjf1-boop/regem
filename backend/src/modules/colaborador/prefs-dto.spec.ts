import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { sanitizeUiPrefs } from '../../common/regras-negocio';
import { UpdatePrefsDto } from './dto/update-prefs.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-504 (17/11/2026): a API valida o corpo com `whitelist: true` (main.ts), que DESCARTA todo campo sem decorador no DTO.
// A ordem pessoal das categorias do Balcão (`pdvOrdemCategorias`) não estava no `UpdatePrefsDto`: o "Organizar" aplicava na
// tela e o servidor recebia `{}` — em produção, nenhuma das 22 pessoas com preferências tinha a ordem gravada. Aqui o corpo
// passa pelo MESMO pipe da API antes da limpeza do serviço.
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const pelaApi = (corpo: any) => pipe.transform(corpo, { type: 'body', metatype: UpdatePrefsDto, data: '' });

// Um valor válido para CADA chave que a limpeza (`sanitizeUiPrefs`) aceita. Chave nova em `UiPrefs` entra aqui — e no DTO.
const TODAS = {
  sidebar: 'collapsed',
  side: 'right',
  pdvOrdemCategorias: ['cat-2', 'cat-1'],
  pdvCartoes: 'compacto',
};

describe('preferências pela API (o DTO não pode descartar o que o serviço grava)', () => {
  it('cada chave que a limpeza aceita chega ao serviço depois do pipe da API', async () => {
    expect(Object.keys(sanitizeUiPrefs(TODAS)).sort()).toEqual(Object.keys(TODAS).sort()); // a lista acima está completa
    const recebido = await pelaApi({ ...TODAS });
    expect(sanitizeUiPrefs(recebido)).toEqual(sanitizeUiPrefs(TODAS));
  });

  it('a ordem do "Organizar" e o tamanho dos cartões chegam sozinhos (o patch parcial do Balcão)', async () => {
    expect(await pelaApi({ pdvOrdemCategorias: ['a', 'b'] })).toMatchObject({ pdvOrdemCategorias: ['a', 'b'] });
    expect(await pelaApi({ pdvCartoes: 'grande' })).toMatchObject({ pdvCartoes: 'grande' });
  });

  it('valor fora do combinado é recusado (400), e campo desconhecido continua descartado', async () => {
    await expect(pelaApi({ pdvCartoes: 'gigante' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pelaApi({ pdvOrdemCategorias: 'cat-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pelaApi({ pdvOrdemCategorias: [1, 2] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pelaApi({ pdvOrdemCategorias: ['x'.repeat(65)] })).rejects.toBeInstanceOf(BadRequestException);
    const r: any = await pelaApi({ side: 'left', qualquer: 1 });
    expect(r).not.toHaveProperty('qualquer');
  });
});
