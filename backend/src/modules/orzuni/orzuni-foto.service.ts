import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ClienteDmsId, ClienteMcp, ErroMcp } from '../../dms/integracao-dms';
import { ehServidorLocal } from '../../common/modo';
import { buscarUrlPublica } from '../../common/ssrf-guard';
import { versaoNoAr } from '../integracao-api/hub.regras';
import { ligacaoDaLoja } from './ligacao-da-loja';
import { desfechoDaRecusa, desfechoDoResultado, lerConfigOrzuni, type ConfigOrzuni } from './orzuni.regras';
import {
  LIMITE_FOTO_IFOOD,
  PERMISSOES_DA_FOTO,
  chaveDaFoto,
  dataUriDaFoto,
  medidaDaImagem,
  problemaDaFoto,
} from './orzuni-foto.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O resultado do "Mandar esta foto ao iFood": a frase da tela e, para a auditoria, se a porta foi chamada e o que ela
 * respondeu. `status` diz a recusa: 404 (produto), 409 (o pedido não serve: ligação, permissão, foto), 503 (o Orzuni não
 * respondeu agora — repetir manda a MESMA chave, a foto não vai duas vezes).
 */
export type ResultadoDaFoto =
  | { ok: true; frase: string; nome: string; resultado: string; repetido: boolean; chamou: true }
  | { ok: false; status: 404 | 409 | 503; motivo: string; nome: string | null; chamou: boolean };

const SEM_RESPOSTA = 'O Orzuni não respondeu agora. Mande de novo daqui a pouco: a mesma foto não vai duas vezes.';
const SEM_PERMISSAO =
  'A ligação da loja com o Orzuni não tem a permissão de editar o cardápio do iFood (catalogo.escrever): a distribuição troca a chave da loja com ela.';

/**
 * "MANDAR ESTA FOTO AO iFOOD" (R3 F6b): a foto do Regem vai ao item do iFood pela porta do Orzuni (`item_foto_definir`,
 * contrato 1.3.0), NA HORA, com a resposta na tela — sem fila (o tipo da fila tem trava no banco; e a foto é um clique
 * de quem está olhando). Só NUVEM: o servidor da loja pede pela conferência (V37). A régua de "acesso vale" é a da porta
 * (V75, `ligacaoDaLoja`), e a ligação precisa de `catalogo.escrever`. A foto é baixada do endereço público dela pela
 * busca segura (V68 — o endereço vem do cadastro), com teto de 8 MB, e conferida pelos bytes antes de sair. Nunca rejeita.
 */
@Injectable()
export class OrzuniFotoService {
  private readonly log = new Logger('OrzuniFoto');
  /** O fetch das duas pontas (DMS ID e porta) — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;
  /** O GET da foto (endereço do cadastro → busca segura) — os testes trocam por um falso. */
  baixar: (url: string) => Promise<Response | null> = (url) => buscarUrlPublica(url, { signal: AbortSignal.timeout(20_000) });
  private dmsId: { chave: string; cliente: ClienteDmsId } | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return (r.rows ?? r) as any[];
  }

  private cliente(cfg: ConfigOrzuni, segredo: string): ClienteMcp {
    const chave = `${cfg.emissor}|${cfg.aplicativo}`;
    if (!this.dmsId || this.dmsId.chave !== chave)
      this.dmsId = { chave, cliente: new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar }) };
    return new ClienteMcp({
      endereco: cfg.endereco,
      recurso: cfg.recurso,
      permissoes: PERMISSOES_DA_FOTO,
      dmsId: this.dmsId.cliente,
      ligacao: segredo,
      cliente: { nome: 'regem', versao: versaoNoAr() },
      buscar: this.buscar,
      tentativas: 2,
    });
  }

  /** Lê o corpo até `teto` bytes; passou, para de ler e devolve `null`. */
  private async lerAte(res: Response, teto: number): Promise<Buffer | null> {
    const leitor = res.body?.getReader();
    if (!leitor) return Buffer.alloc(0);
    const partes: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > teto) {
        await leitor.cancel().catch(() => undefined);
        return null;
      }
      partes.push(Buffer.from(value));
    }
    return Buffer.concat(partes);
  }

  async mandar(tenantId: string, unidadeId: string, produtoId: string): Promise<ResultadoDaFoto> {
    const cfg = lerConfigOrzuni();
    if (ehServidorLocal() || !cfg.envioLigado)
      return { ok: false, status: 409, motivo: 'O iFood pelo Orzuni não está ligado nesta instalação.', nome: null, chamou: false };
    const lig = await ligacaoDaLoja(this.db, tenantId, unidadeId, this.log);
    if ('motivo' in lig) return { ok: false, status: 409, motivo: lig.motivo, nome: null, chamou: false };
    const [perm] = await this.rows(sql`
      select l.permissoes from orzuni_ligacao l
       where l.unidade_id = ${unidadeId}::uuid and l.tenant_id = ${tenantId}::uuid and l.revogada_em is null limit 1`);
    const permissoes: string[] = Array.isArray(perm?.permissoes) ? perm.permissoes.map(String) : [];
    if (!permissoes.includes('catalogo.escrever')) return { ok: false, status: 409, motivo: SEM_PERMISSAO, nome: null, chamou: false };

    const [p] = await this.rows(sql`
      select nome, codigo, no_ifood, imagem_ref from produto
       where id = ${produtoId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null
         and (unidade_id = ${unidadeId}::uuid or unidade_id is null)`);
    if (!p) return { ok: false, status: 404, motivo: 'Produto não encontrado nesta loja.', nome: null, chamou: false };
    const nome = String(p.nome);
    const codigo = String(p.codigo ?? '').trim();
    if (!p.no_ifood || !codigo)
      return { ok: false, status: 409, motivo: `"${nome}" não está no iFood com código PDV: a foto não tem para onde ir.`, nome, chamou: false };
    const url = String(p.imagem_ref ?? '').trim();
    if (!url) return { ok: false, status: 409, motivo: `"${nome}" não tem foto no Regem.`, nome, chamou: false };
    if (!/^https:\/\//i.test(url))
      return { ok: false, status: 409, motivo: 'A foto ainda está só no servidor da loja: ela sobe para a nuvem em instantes. Mande de novo daqui a pouco.', nome, chamou: false };

    // A foto, pelos bytes (o tipo que o servidor da foto diz não vale): até 8 MB, JPG ou PNG, quadrada, 300 px ou mais.
    let foto: Buffer | null = null;
    try {
      const res = await this.baixar(url);
      if (res?.ok) {
        const declarado = Number(res.headers.get('content-length') ?? '0');
        if (declarado > LIMITE_FOTO_IFOOD) {
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, status: 409, motivo: problemaDaFoto(null, declarado) as string, nome, chamou: false };
        }
        foto = await this.lerAte(res, LIMITE_FOTO_IFOOD);
        if (!foto) return { ok: false, status: 409, motivo: problemaDaFoto(null, LIMITE_FOTO_IFOOD + 1) as string, nome, chamou: false };
      } else if (res) {
        await res.body?.cancel().catch(() => undefined);
      }
    } catch (e: any) {
      this.log.warn(`foto de ${produtoId}: não deu para baixar (${e?.message ?? e})`);
    }
    if (!foto) return { ok: false, status: 503, motivo: 'Não deu para ler a foto do Regem agora. Tente de novo em instantes.', nome, chamou: false };
    const medida = medidaDaImagem(foto);
    const problema = problemaDaFoto(medida, foto.length);
    if (problema || !medida) return { ok: false, status: 409, motivo: problema ?? 'A foto não serve para o iFood.', nome, chamou: false };

    const mcp = this.cliente(cfg, lig.segredo);
    try {
      const dados = await mcp.chamar('item_foto_definir', {
        codigo_pdv: codigo,
        imagem: dataUriDaFoto(medida, foto),
        chaveIdempotencia: chaveDaFoto(produtoId, foto),
      });
      const d = desfechoDoResultado(dados);
      if (d.resultado === 'nao_encontrado') return { ok: false, status: 409, motivo: semItem(codigo), nome, chamou: true };
      if (d.resultado === 'recusado') return { ok: false, status: 409, motivo: 'O Orzuni recusou a foto.', nome, chamou: true };
      const repetido = d.resposta.repetido === true;
      const frase =
        d.resultado === 'sem_mudanca'
          ? `O iFood já tem esta foto em "${nome}".`
          : repetido
            ? `Esta foto já tinha ido ao iFood em "${nome}".`
            : `A foto de "${nome}" foi para o iFood.`;
      return { ok: true, frase, nome, resultado: d.resultado, repetido, chamou: true };
    } catch (e: any) {
      return { ...this.recusa(e, codigo), nome, chamou: true };
    }
  }

  private recusa(e: any, codigo: string): { ok: false; status: 409 | 503; motivo: string } {
    if (!(e instanceof ErroMcp)) {
      this.log.warn(`foto ao iFood: ${e?.message ?? e}`);
      return { ok: false, status: 503, motivo: SEM_RESPOSTA };
    }
    switch (e.tipo) {
      case 'ferramenta': {
        const d = desfechoDaRecusa(e);
        const cod = String(d.resposta.codigo ?? '');
        if (d.resultado === 'nao_encontrado' || cod === 'pdv_inexistente') return { ok: false, status: 409, motivo: semItem(codigo) };
        if (cod === 'imagem_grande') return { ok: false, status: 409, motivo: 'A foto passa de 8 MB e o iFood não aceita: use uma menor.' };
        if (d.repetir) return { ok: false, status: 503, motivo: SEM_RESPOSTA };
        const frase = typeof d.resposta.frase === 'string' ? d.resposta.frase : '';
        if (cod === 'dados_invalidos') return { ok: false, status: 409, motivo: frase || 'O iFood recusou a foto: mande JPG ou PNG quadrada, de 300 px de lado ou mais.' };
        return { ok: false, status: 409, motivo: frase || 'O Orzuni recusou a foto.' };
      }
      case 'permissao':
        return { ok: false, status: 409, motivo: SEM_PERMISSAO };
      case 'ligacao':
        return { ok: false, status: 409, motivo: 'O Orzuni não reconhece mais a ligação da loja — a distribuição registra a chave de novo.' };
      case 'recusada':
        return { ok: false, status: 503, motivo: 'A conta da loja no Orzuni está suspensa ou sem iFood agora.' };
      case 'limite':
        return { ok: false, status: 503, motivo: 'O Orzuni está no limite de pedidos agora. Tente de novo em um minuto.' };
      case 'indisponivel':
      case 'sem-resposta':
      case 'token':
        return { ok: false, status: 503, motivo: SEM_RESPOSTA };
      default:
        this.log.error(`foto ao iFood: ${e.message}`);
        return { ok: false, status: 409, motivo: 'O Orzuni recusou a foto.' };
    }
  }
}

function semItem(codigo: string): string {
  return `O iFood não tem item com o código ${codigo}: crie-o no Gestor de Pedidos com o mesmo código e mande de novo.`;
}
