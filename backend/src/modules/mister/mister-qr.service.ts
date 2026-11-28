import { BadRequestException, ConflictException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { CABECALHO_ASSINATURA_EVOLUTION, assinaturaDaInstancia } from '../../common/segredo-robo';
import { Autor, FalhaDoEnvioDoMister, MisterNumeroService, NumeroDoMister } from './mister-numero.service';
import { VERSAO_DO_ACEITE, nomeDaInstancia, numeroDoDono, situacaoPelaConexao, textoDoNumeroNovo } from './mister-qr';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONEXÃO POR QR CODE DO NÚMERO DO MISTER NO CONSOLE (Q2 e Q3; mig 437; protótipo `mockups/regem-mister-qr.html`). Só a
// Diretoria, só na nuvem. Uma forma por vez: a troca para o QR acontece quando o celular CONECTA; a volta para a API oficial
// é um botão. Trocar a forma não mexe nas ligações das pessoas (são pelo telefone de quem escreve). O número novo é
// anunciado a cada pessoa ligada UMA vez (gravação condicional em `numero_anunciado`), no ritmo do envio.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');

@Injectable()
export class MisterQrService {
  private readonly logger = new Logger('MisterQr');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
  ) {}

  private exigirNuvem() {
    if (ehServidorLocal()) throw new ServiceUnavailableException('A conexão do Mister só muda na nuvem.');
  }

  /** O endereço de entrada da instância: a porta assinada do Regem (a mesma das lojas), nunca o n8n. */
  private webhook(instancia: string) {
    const base = (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');
    return { url: `${base}/publico/whatsapp/evolution/webhook`, headers: { [CABECALHO_ASSINATURA_EVOLUTION]: assinaturaDaInstancia(instancia) } };
  }

  /** O Evolution e a assinatura configurados (o console mostra; sem eles, nada de QR). */
  pronto(): boolean {
    return this.numero.evolutionPronto(assinaturaDaInstancia('conferencia'));
  }

  private async marcar(situacao: string, motivo: string | null): Promise<void> {
    await this.db.execute(sql`
      update mister_numero
         set instancia_situacao = ${situacao}, instancia_motivo = ${motivo}, atualizado_em = now(),
             instancia_situacao_em = case when instancia_situacao = ${situacao} then instancia_situacao_em else now() end
       where id = 1`);
  }

  /** O aceite do risco (decisão 2): o texto de AGORA; fica com o nome e a data (a rota grava a auditoria do console). */
  async aceitar(dto: unknown, autor: Autor): Promise<NumeroDoMister> {
    this.exigirNuvem();
    const d: any = dto ?? {};
    if (d.aceito !== true || d.versao !== VERSAO_DO_ACEITE) throw new BadRequestException('Marque o aceite do texto do risco de agora.');
    await this.db.execute(sql`
      update mister_numero set aceite_por = ${String(autor?.nome ?? '').slice(0, 80) || null}, aceite_em = now(), aceite_versao = ${VERSAO_DO_ACEITE}, atualizado_em = now()
       where id = 1`);
    return this.numero.ler();
  }

  /**
   * O QR Code: prepara a instância do Mister (ou uma NOVA, com "conectar outro número" depois de bloqueado) e devolve a
   * imagem. A situação vira "conectando" até o celular ler o QR. Pede o aceite do texto de agora.
   */
  async gerarQr(dto: unknown, autor: Autor): Promise<NumeroDoMister & { qr: { imagem: string | null; codigo: string | null } | null }> {
    this.exigirNuvem();
    if (!this.pronto()) throw new ServiceUnavailableException('O Evolution da distribuição não está configurado neste servidor.');
    const n = await this.numero.ler();
    if (!n.aceite || n.aceite.versao !== VERSAO_DO_ACEITE) throw new ConflictException('Aceite o risco antes de gerar o QR Code.');
    const outro = (dto as any)?.outroNumero === true;
    // A troca do QR a cada 20 s (a tela pede `renovar`): só o QR novo da mesma instância, sem refazer a instância e o webhook.
    const renovar = (dto as any)?.renovar === true && !outro && !!n.instancia;
    if (outro && n.instancia) await this.numero.evolutionSair(n.instancia);
    const instancia = !outro && n.instancia ? n.instancia : nomeDaInstancia(randomBytes(4).toString('hex'));
    try {
      if (!renovar) await this.numero.evolutionPreparar(instancia, this.webhook(instancia));
      const qr = await this.numero.evolutionQr(instancia);
      await this.db.execute(sql`
        update mister_numero
           set instancia = ${instancia}, ${outro ? sql`instancia_numero = null,` : sql``} atualizado_em = now()
         where id = 1`);
      // ERR-649: "conectando" marca que a Diretoria PEDIU o QR — é o que deixa a conexão trocar a forma do Mister.
      if (qr.jaConectado) {
        await this.marcar('conectando', null);
        return { ...(await this.conferir()), qr: null };
      }
      await this.marcar('conectando', null);
      this.logger.log(`mister: QR Code gerado para a instância ${instancia} por ${autor?.nome ?? '?'}`);
      return { ...(await this.numero.ler()), qr: { imagem: qr.imagem, codigo: qr.codigo } };
    } catch (e: any) {
      if (e instanceof FalhaDoEnvioDoMister) throw new ServiceUnavailableException(`O Evolution não respondeu como esperado${e.detalhe ? `: ${e.detalhe}` : ''}.`);
      throw e;
    }
  }

  /**
   * A conferência da conexão (a tela chama enquanto o QR está na tela; o aviso de conexão do Evolution faz o mesmo):
   * conectado = o número do celular, a forma passa a ser o QR e o número novo é anunciado; a que estava conectada e fechou,
   * "caiu".
   */
  async conferir(): Promise<NumeroDoMister> {
    const n = await this.numero.ler();
    if (!n.instancia) return n;
    const estado = await this.numero.evolutionEstado(n.instancia);
    if (estado === 'open') return this.conectou(n.instancia);
    if (estado === 'close' && n.instanciaSituacao === 'conectado') await this.marcar('caiu', situacaoPelaConexao('close', null)!.motivo);
    return this.numero.ler();
  }

  /** O aviso de conexão do Evolution (`CONNECTION_UPDATE`) da instância do Mister. Devolve se era dela. */
  async conexaoDoEvolution(instancia: string, dados: any): Promise<boolean> {
    const n = await this.numero.ler();
    if (!n.instancia || n.instancia !== instancia) return false;
    const s = situacaoPelaConexao(dados?.state, dados?.statusReason);
    if (!s) return true;
    if (s.situacao === 'conectado') await this.conectou(instancia, numeroDoDono(dados?.wuid));
    // O QR que venceu sem ninguém ler fecha a conexão: volta a "não conectado", não "caiu" (nada tinha conectado).
    else if (n.instanciaSituacao === 'conectando' && s.situacao === 'caiu') await this.marcar('sem', null);
    else if (n.instanciaSituacao !== 'sem') await this.marcar(s.situacao, s.motivo);
    return true;
  }

  private async conectou(instancia: string, doAviso: string | null = null): Promise<NumeroDoMister> {
    const numero = doAviso ?? numeroDoDono(await this.numero.evolutionDono(instancia));
    // ERR-649 (rodada 7 de segurança, MIS-A-05): a forma do Mister só passa a ser o QR na conexão que a Diretoria PEDIU (saindo
    // de "conectando", o QR gerado no console). A reconexão sozinha do celular ainda pareado (a Evolution reiniciou) não desfaz
    // a escolha da API oficial feita no console.
    // Rodada 7, MIS-G-08 (ERR-659): o celular que a Diretoria DESCONECTOU ("sem") não volta por um aviso atrasado nem por uma
    // reconexão da Evolution (o logout pode ter falhado): só um QR novo (que passa por "conectando") conecta de novo.
    const mudou = linhas(
      await this.db.execute(sql`
        update mister_numero
           set instancia_situacao = 'conectado', instancia_motivo = null, atualizado_em = now(),
               provedor = case when instancia_situacao = 'conectando' then 'evolution' else provedor end,
               instancia_situacao_em = case when instancia_situacao = 'conectado' then instancia_situacao_em else now() end,
               instancia_conectada_em = case when instancia_situacao = 'conectado' then instancia_conectada_em else now() end,
               instancia_numero = coalesce(${numero}, instancia_numero)
         where id = 1 and instancia = ${instancia} and instancia_situacao <> 'sem'
        returning id`),
    );
    if (!mudou.length) {
      this.logger.warn('mister: o celular desconectado no console voltou a abrir na Evolution — ignorado (gere um QR novo para conectar)');
      return this.numero.ler();
    }
    void this.anunciarNumeroNovo().catch((e) => this.logger.warn(`mister: o aviso do número novo não saiu — ${e?.message ?? e}`));
    return this.numero.ler();
  }

  /** "Trocar para a API oficial" (com ela conectada) ou "Trocar para a conexão por QR Code" (com o celular conectado). */
  async trocar(dto: unknown): Promise<NumeroDoMister> {
    this.exigirNuvem();
    const para = (dto as any)?.para;
    const n = await this.numero.ler();
    if (para === 'oficial') {
      if (n.situacao !== 'conectado' || !n.phoneId) throw new ConflictException('A API oficial não está conectada. Conecte o número oficial antes de trocar.');
      await this.db.execute(sql`update mister_numero set provedor = 'oficial', atualizado_em = now() where id = 1`);
      return this.numero.ler();
    }
    if (para === 'qr') {
      if (n.instanciaSituacao !== 'conectado' || !n.instancia) throw new ConflictException('O celular ainda não está conectado. Gere o QR Code e leia no celular antes de trocar.');
      await this.db.execute(sql`update mister_numero set provedor = 'evolution', atualizado_em = now() where id = 1`);
      void this.anunciarNumeroNovo().catch((e) => this.logger.warn(`mister: o aviso do número novo não saiu — ${e?.message ?? e}`));
      return this.numero.ler();
    }
    throw new BadRequestException('Escolha a forma: a API oficial ou a conexão por QR Code.');
  }

  /** Desconecta o celular do Evolution. Com o QR em uso, nada sai pelo WhatsApp até conectar de novo ou trocar a forma. */
  async desconectar(): Promise<NumeroDoMister> {
    this.exigirNuvem();
    const n = await this.numero.ler();
    if (n.instancia) await this.numero.evolutionSair(n.instancia);
    await this.db.execute(sql`
      update mister_numero set instancia_situacao = 'sem', instancia_motivo = null, instancia_situacao_em = now(), instancia_numero = null, atualizado_em = now()
       where id = 1`);
    return this.numero.ler();
  }

  /**
   * Q3: "este é o novo número do Mister" para cada telefone ligado (sem quem pediu PARAR AVISOS), pelo número novo, no
   * ritmo do envio. Uma vez por número: a gravação condicional em `numero_anunciado` decide quem manda (reconectar o
   * mesmo celular não anuncia de novo; duas conferências juntas, uma manda). Devolve quantas saíram.
   */
  async anunciarNumeroNovo(): Promise<number> {
    const n = await this.numero.ler();
    // Com a chave geral desligada, nada sai: o anúncio espera o "Ligar o Mister" (a rota da chave chama de novo).
    if (!n.ligado || n.provedor !== 'evolution' || n.instanciaSituacao !== 'conectado' || !n.instanciaNumero) return 0;
    const [vez] = linhas(
      await this.db.execute(sql`
        update mister_numero set numero_anunciado = ${n.instanciaNumero}, atualizado_em = now()
         where id = 1 and numero_anunciado is distinct from ${n.instanciaNumero}
        returning id`),
    );
    if (!vez) return 0;
    const pessoas = linhas(
      await this.db.execute(sql`
        select distinct on (v.telefone) v.telefone, c.nome
          from mister_vinculo v
          join colaborador c on c.id = v.colaborador_id and c.tenant_id = v.tenant_id
         where v.ligado_em is not null and v.telefone is not null and v.pausado_em is null
         order by v.telefone, v.ligado_em`),
    );
    let saiu = 0;
    for (const p of pessoas) {
      try {
        await this.numero.enviar(String(p.telefone), { texto: textoDoNumeroNovo(p.nome) });
        saiu++;
      } catch (e: any) {
        this.logger.warn(`mister: o número novo não chegou a ${mascarar(String(p.telefone))} — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
      }
    }
    if (!saiu && pessoas.length) {
      // Nenhum saiu (o Evolution fora, o celular caiu no meio): o número volta a "não anunciado", e a próxima conexão,
      // conferência ou "Ligar o Mister" tenta de novo.
      await this.db.execute(sql`
        update mister_numero set numero_anunciado = ${n.numeroAnunciado}, atualizado_em = now()
         where id = 1 and numero_anunciado = ${n.instanciaNumero}`);
    }
    this.logger.log(`mister: número novo anunciado a ${saiu} de ${pessoas.length} telefones`);
    return saiu;
  }
}
