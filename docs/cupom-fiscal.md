# Cupom fiscal (NFC-e) — informação e datas

> **Para que serve:** fonte única do que a lei exige do nosso cupom, do que muda por estado, das
> datas da transição tributária e do que ainda **não está confirmado**. Consultar **antes** de mexer
> em `backend/src/modules/fiscal/*`, em `fiscal_config`/`fiscal_serie`/`nota_fiscal` ou em qualquer
> cálculo que entre na nota.
>
> **Como manter:** toda afirmação aqui tem fonte. O que não tiver fonte oficial fica na seção
> **§7 Dependências não confirmadas** — nunca no corpo como se fosse verdade. Ao confirmar um item,
> mova-o para a seção certa e registre no §8 (changelog).
>
> Pesquisa base: 20/09/2026 (CONFAZ, Portal Nacional da NF-e, CGIBS, Receita Federal, SEFAZ estaduais).

---

## 1. Estado do nosso emissor

| Área | Situação |
|---|---|
| Montagem do XML (infNFe 4.00) | Existe — `nfce-xml.builder.ts` |
| Chave de 44 dígitos, DV módulo 11, QR Code **v2** (SHA-1 + CSC) e **v3** (NT 2025.001, sem CSC) | Existe — `chave.ts`; a versão por UF em `sefaz/webservices.ts` |
| Numeração por série, com reserva atômica | Existe — `fiscal_serie` (mig 278) |
| Emissão à prova de configuração faltando (*fail-closed*) | Existe — mig 278 / `transmitter.ts` |
| **Certificado A1 e CSC guardados cifrados** (AES-256-GCM, fora do sync) | Existe — mig 279 / `credencial.ts`, `cifra-segredo.ts` |
| Leitura do .pfx (cadeia, CNPJ, validade, raiz do CNPJ × emitente) | Existe — `certificado.ts` |
| Entrega do certificado ao servidor LOCAL | NÃO EXISTE (etapa seguinte do P2) |
| **Assinatura XML-DSig com o A1** | Existe — `assinatura.ts` (etapa B), conferida por dois caminhos independentes |
| Grupo `<infNFeSupl>` (QR Code + URL de consulta pela chave) | Existe — etapa B (antes o QR nunca ia para o XML) |
| Conexão com a SEFAZ: SOAP 1.2, certificado de cliente, raiz ICP-Brasil, consulta de status | Existe — `sefaz/` (etapa C1) |
| **Transmissão real à SEFAZ** (`NFeAutorizacao4`, lote síncrono) | Existe — `sefaz/autorizacao.ts` (etapa C2) |
| NFC-e de teste em homologação (1 item de R$ 1,00, sem venda) | Existe — rota só-nuvem + botão na tela (etapa C2) |
| Validação do XML contra o **XSD oficial** (PL_009_V4) dentro da suíte | Existe — `nfce-xsd.spec.ts` |
| **NFC-e AUTORIZADA pela SEFAZ** (homologação, SVRS/RJ) | ✅ 22/09/2026 — nº 2, série 51, protocolo `333260002547395`, cStat 100 |
| Consulta da situação pela chave (`NFeConsultaProtocolo4`) + resolução da nota `pendente` | Existe — `sefaz/consulta-protocolo.ts`, rota, botão e job (P18) |
| **Inutilização** de numeração (`NFeInutilizacao4`) + relatório de lacunas | Existe — `sefaz/inutilizacao.ts`, migs 282/283 (P19) |
| Reaproveitamento de número | **NÃO EXISTE — e não vai existir**: o MOC veda (ver §5.1) |
| Cancelamento por substituição (evento 110112, 168 h) | Existe — `sefaz/evento-cancelamento.ts`, mig 284 (P20) |
| Contingência off-line `tpEmis=9` | NÃO EXISTE (P21 — e depende de o RJ permitir) |
| Contingência `tpEmis=9` de verdade (fila + efetivação) | NÃO EXISTE |
| Inutilização de faixa | NÃO EXISTE |
| Grupos IBS/CBS/IS (reforma) | NÃO EXISTE |

**O emissor já fala com a SEFAZ de verdade**: monta, assina, transmite e só grava "autorizada" com
protocolo na mão. Em produção ainda faltam duas coisas do §7: resolver a nota que fica `pendente`
(P18, feito) e o número queimado (P19, feito). O que ainda falta para produção é o cancelamento por
substituição (P20) e a contingência off-line (P21). O modo simulado continua recusado em produção (§5).

---

## 2. O que é nacional — pode ser constante no código

Base: **Ajuste SINIEF 19/16**, texto compilado (inclui até o Ajuste 9/26) —
https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16

- **Numeração:** 1 a 999.999.999, **por estabelecimento E por série** (cl. 4ª, II).
- **Série:** algarismos arábicos, ordem crescente; **série única = 0**; **subsérie vedada** (cl. 4ª, §1º).
  **Não existe faixa de série reservada para contingência** — o inciso que exigia 501-999 foi
  revogado pelo Ajuste 26/19, e a redação anterior (890-989) está "sem efeitos".
- **Quantidade de séries:** sem teto nacional; "o Fisco **poderá** restringir" (cl. 4ª, §2º).
- **Comunicar série à SEFAZ:** não é preciso. Nenhuma SEFAZ homologa software, impressora ou série —
  **salvo SC** (PAF-NFC-e credenciado).
- **Cancelamento:** ≤ **30 minutos**, sem saída da mercadoria; **168 h** quando substitui nota emitida
  em contingência (cl. 15ª e 15ª-A). Cancelamento é **evento**, nunca *delete*.
- **Inutilização:** números não usados, até o **10º dia do mês subsequente** (cl. 16ª).
  **A partir do 11º dia, quebra de sequência sem inutilização é presumida como "documento emitido em
  contingência e não transmitido"** (cl. 11ª, §5º). Número pulado e esquecido vira presunção de omissão.
- **Contingência off-line:** transmitir até o **1º dia útil subsequente** (MOC 7.0 Anexo IV);
  **proibido** reaproveitar número já transmitido como "Normal" e **proibido** inutilizar número
  emitido em contingência (cl. 11ª, §2º). O DANFE off-line fica à disposição do Fisco até autorizar.
- **Não existe CC-e para NFC-e.**
- **Devolução ≠ cancelamento:** devolução pelo consumidor se resolve com **NF-e modelo 55 de entrada**.
- **Guarda:** XML por **5 anos**, sob responsabilidade do emitente. O DANFE não precisa ser guardado.
- **Escrituração (EFD):** modelo "65", **uma NFC-e por vez em C100 + C190**, pela **data de emissão**
  (mesmo que a autorização venha depois). Canceladas e inutilizadas entram sem valores.
- **Limites:** vedada NFC-e ≥ **R$ 200.000**; CPF/CNPJ obrigatório ≥ **R$ 10.000** e — **desde
  03/08/2026 (Ajuste 9/26)** — em **toda operação não presencial, com o endereço**.
  ⚠️ Isso alcança **nosso delivery e nosso pedido online**.
- **Intermediador:** a nota deve conter o **CNPJ do intermediador/agenciador** (cl. 4ª, XII) —
  iFood, 99Food, marketplaces.
- **NFC-e com destinatário CNPJ voltou a ser permitida:** o Ajuste 11/25 foi **revogado** pelo
  **Ajuste 12/26** (DOU 09/04/2026). Se algum ponto do código bloqueia CNPJ, está errado.

---

## 3. O que varia por estado — tem de ser configuração por loja, nunca literal

| Parâmetro | Variação |
|---|---|
| **Autorizador** | 7 próprios (AM, GO, MS, MT, PR, RS, SP) + **SVRS** para as outras 20 — endpoints e janelas de indisponibilidade diferentes |
| **URL do QR Code / consulta** | por UF e por ambiente. O IT 2025.003 mudou só a de **GO** |
| **CSC** | quantidade (2 por ambiente em PR/DF/PE/RJ), escopo (CNPJ raiz × por estabelecimento × "todos no estado" em MG), **ID Token fixo `000001` no ES**, e **vigência com início/fim** — o padrão do QR prevê os erros "CSC expirado em DD/MM/AAAA" e "CSC ainda não está ativo" |
| **Contingência** | **PR exige transmitir em 24 h** (não "1º dia útil"); **CE** aceita MF-e além do off-line; **SP** só liberou a off-line em jul/2024 (Portaria SRE 40/2024). A UF pode **bloquear** a off-line por regra de validação e **restringir individualmente** quem usa "em demasia e sem justificativa" |
| **Cancelamento extemporâneo** | **AM: 90 dias** (duplicidade); **RJ:** sistema de reabertura de prazo; **MG e SP: não existe** (denúncia espontânea / SIPET, Portaria CAT 83/2020); **BA:** NF de regularização em 60 dias; **ES:** NF-e 55 de ajuste |
| **Limites** | total (default R$ 200.000) e sem destinatário (default R$ 10.000) são **parametrizáveis por UF**; exigir nome/endereço acima de R$ 10.000 é RV **opcional a critério da UF**; `indPres=4` (entrega a domicílio) pode ser **bloqueado pela UF** |
| **Credenciamento** | automático (RJ; PR em homologação) × por pedido (SP, MS, MG, PE); por **CNPJ** (RJ, BA) × por **estabelecimento** (SP, PR); com etapa formal de homologação (MS, PE) ou sem |
| **Software credenciado** | **só SC** (PAF-NFC-e) |
| **Série "0"** | Nacional e BA: permitida **só** para série única. **ES e AL publicam que o zero é vedado.** → **nunca usar a série 0** |
| **GO — exigência própria** | **IN 1.608/2025:** todo pagamento eletrônico (inclusive **PIX**) exige o **grupo YA** com CNPJ/CPF do beneficiário, **código de autorização**, data/hora, valor e **identificador do terminal**. Cronograma por faixa de faturamento até **01/02/2027**. **Delivery e venda por plataforma estão expressamente fora.** |

**Nenhuma UF usa outro documento hoje.** SP encerrou o SAT-CF-e em 31/12/2025 (Portaria SRE 79/2024)
e CE vedou o CF-e/MF-e em 01/01/2026 (Decreto 36.417/2025). SAT e ECF sobrevivem apenas como
alternativa de contingência (cl. 11ª, II).

---

## 4. Calendário — reforma tributária no cupom

Fontes: NT 2025.002-RTC v1.51; Ato Conjunto RFB/CGIBS nº 4, de 30/07/2026; LC 214/2025 (com LC 227/2026);
Decreto 12.955/2026 (RCBS); Resolução CGIBS nº 6/2026 (RIBS).

| Data | O que acontece | Alcança quem |
|---|---|---|
| **03/08/2026** ✅ vencido | Grupo `IBSCBS` obrigatório em **todo item** da NF-e 55 e da NFC-e 65 | emitente **CRT 3** (Lucro Real/Presumido) |
| **03/08/2026** | `xMun`, endereço e CPF/CNPJ obrigatórios em **operação não presencial** (Ajuste 9/26) | todos |
| **01 a 30/09/2026** | Janela de opção do **Simples** pelo regime regular de IBS/CBS (efeitos 01/01/2027, cancelável até 30/11) | clientes do Simples |
| **05/10/2026 HML · 03/11/2026 PROD** | NT 2026.006 — grupo **`YC gPgtoVinc`** + evento **110300** (split payment). **Não está no pacote de schemas atual** → nova troca de XSD | todos |
| **01/01/2027** | Grupo IBS/CBS obrigatório para **Simples/MEI** (rejeição a partir de **04/01/2027**) | **CRT 1/2/4 — a maioria dos bares e restaurantes** |
| **01/01/2027** | **CBS cheia**; **PIS e COFINS extintos**; IPI a zero; **Imposto Seletivo** começa. `pIBSUF` e `pIBSMun` passam a **0,05%** cada | todos |
| **2029-2032** | ICMS e ISS reduzidos a 9/10, 8/10, 7/10 e 6/10; IBS sobe na mesma medida | todos |
| **01/01/2033** | **ICMS e ISS extintos**. Só IBS + CBS + IS | todos |

**Alíquotas de 2026:** `pIBSUF = 0,1` · `pIBSMun = 0` · `pCBS = 0,9`. Apuração **meramente informativa**,
compensada com PIS/COFINS, **recolhimento dispensado** para quem cumprir as acessórias
(Ato Conjunto RFB/CGIBS nº 1, de 22/12/2025). **Optantes do Simples estão fora das alíquotas de 2026**
(LC 214, art. 348, III, "c").

**`pCBS` de 2027 ainda não foi fixada** — a tabela oficial diz "aguarda legislação". TCU envia ao
Senado até 30/10/2026; Senado fixa até 15/12/2026. → **`pCBS` é dado de tabela por ano, jamais constante.**

### 4.1 Três armadilhas técnicas
1. **O XSD não protege.** `IBSCBS` é `minOccurs="0"` no schema — a validação local passa e a SEFAZ
   rejeita com **1115**. O portão tem de ser teste de domínio, não de schema.
2. **`cStat = 120` ("Autorizado o uso da NF-e, com alerta", NT 2026.002, inicialmente só para NFC-e)
   é SUCESSO.** Quem tratar como erro cai em contingência e **duplica a venda**. Sucesso = `100 | 120 | 150`.
3. **Homologação mente.** A NT tem exceções do tipo "esta regra não se aplica para a CBS em
   homologação", e a implantação em HML "pode variar por UF". Passar em HML não garante produção.

### 4.2 Regime específico de bar e restaurante (LC 214, arts. 273-276; RIBS/RCBS 396-401)
- **Alíquota reduzida em 40%** para alimentação e bebida não alcoólica **preparada no estabelecimento**
  — `cClassTrib 200047`.
- **Fora do regime:** bebida alcoólica (mesmo preparada), revenda sem preparo, refeição coletiva por
  contrato e — pegadinha do regulamento — **bebida não alcoólica industrializada, ainda que preparada
  junto com outras** (refrigerante em lata).
- **Gorjeta fora da base** se repassada integralmente ao empregado **e ≤ 15%** — `cClassTrib 410019`.
- **O que a plataforma retém** (comissão + entrega) fora da base — `cClassTrib 410020`.
- **RIBS/RCBS art. 398 — a regra mais cara para nós:** o documento **deve segregar** o que é regime
  específico do que é regime geral; **sem segregação, o valor total cai no regime geral**.
  O art. 399, §§2º e 4º repete isso para gorjeta e intermediação.
  → Hoje a comanda sai como um bloco e **`comanda.total` embute `taxa_servico_pct`**. A partir de 2027
  isso deixa de ser questão de relatório e vira **perda da redução de 40% na comanda inteira**.
- **Crédito:** vedado ao **adquirente** (art. 276); **mantido** nas compras do próprio estabelecimento
  (art. 47, §10).

### 4.3 Risco que é nosso, não do cliente
**LC 214, art. 341-G, VI** (incluído pela LC 227/2026): **desenvolver, fornecer ou instalar** software
que emita documento fiscal fora dos requisitos da legislação → **150 UPF por equipamento**.
Passa a existir multa **no fornecedor do PDV**, por caixa instalado.

---

## 5. Decisões tomadas

| # | Decisão | Por quê |
|---|---|---|
| D1 | **Emissão direta na SEFAZ, sem hub fiscal** | O PDV precisa vender com a internet caída. API de hub em nuvem é **síncrona** e não emite offline; os dois hubs que emitem offline (Focus "Comunicador Offline", TecnoSpeed "NeverStop") fazem isso **instalando um binário de terceiro na loja** — trocaríamos o nosso servidor local pelo `.exe`/`.jar` deles no caminho crítico do caixa. Somado ao risco de fornecedor (a **Nuvem Fiscal foi desligada em 31/07/2026**), direto é mais seguro. Hub continua candidato para o que **não é caixa**: NFS-e, distribuição das notas de entrada, CT-e/MDF-e. |
| D2 | **Série por origem (ponto de emissão)** | Legal e sem comunicação prévia (cl. 4ª, §1º + manual: séries "por checkout ou caixa"). Resolve a partição nuvem × loja **por desenho**: cada origem tem contador próprio, então nenhuma das duas fura a sequência da outra, e não existe alocador único para cair. |
| D3 | **A origem é decidida por ONDE o código roda** (`ehServidorLocal()`), não pela origem do pedido | É o único critério à prova de partição: o servidor local e a nuvem nunca compartilham contador. Se o edge cair, a venda emitida pela nuvem sai na série da nuvem — legal, e sem colisão. |
| D4 | **Nunca usar a série 0** | ES e AL publicam que o zero é vedado, contra o texto nacional. Fora do 0, a divergência não nos alcança. |
| D5 | **Não presumir a faixa 890-999 livre** | Está documentada para NF-e 55; **não confirmada** para o modelo 65. |
| D6 | **Sem transmissor real, a emissão é recusada** | Gravar "autorizada" sem ter emitido documenta a venda como fiscal sem ser. O simulado só roda em `ambiente = 2` **e** com `FISCAL_SIMULADO=true`. |
| D7 | **Continuar arquivando os 5 anos de XML do nosso lado**, decida-se o que se decidir | A Focus guarda 6 meses; o PlugNotas cobra guarda em produto separado, sem preço público. A obrigação é do emitente. |
| D8 | **CSC, certificado e URLs de QR são da DISTRIBUIÇÃO** | Regra do projeto: segredo e credencial nunca são do usuário. O lojista informa o mínimo; nós concluímos. |

---

## 6. Como está implementado

- **`fiscal_serie`** (mig 278) — um contador por `(tenant, unidade, origem)`; `origem ∈ {loja, nuvem}`.
  `id` derivado da chave de negócio (`uuidDeChave`), como tarefa/escala (mig 277), para as duas pontas
  materializarem a mesma linha sem duplicar.
- **Contador auto-recuperável:** a reserva usa `greatest(proximo_numero, max(nota_fiscal.numero)+1)` na
  mesma série. Reinstalação ou restauração não faz o número voltar atrás nem repetir chave.
- **Índice único** `(tenant, unidade, modelo, serie, numero)` em `nota_fiscal` — dupla alocação vira erro,
  não duplicata silenciosa.
- **Pré-voo da emissão:** sem CNPJ, IE, UF, código de UF/município, município, endereço, bairro, número,
  CSC ou URL de QR, a emissão é **recusada com a lista do que falta** — em vez de sair com `N/D` e
  `00000000000000`.
- **`dhEmi` no fuso da UF** (`fuso-fiscal.ts`): AC −05:00; AM, MT, MS, RO, RR −04:00; demais −03:00.
  A competência `AAMM` da chave vem **do mesmo instante local**, senão vira o mês errado na virada.
- **`cStat`** já viaja no retorno do transmissor, e `ehAutorizado()` aceita **100, 120 e 150**.
- **Certificado A1 e CSC — `fiscal_credencial`** (mig 279):
  - cifrados com **AES-256-GCM** e a chave `SEGREDOS_CHAVE` **deste** servidor (a nuvem tem a
    sua; cada loja terá a dela). GCM autentica: dado alterado no banco é **recusado**, não lido;
  - a tabela **não sincroniza** — com chaves diferentes, o valor de um lado não abre no outro, e
    uma loja comprometida não expõe as demais;
  - **sem a chave, nada é guardado** (recusa com a instrução de como gerar), nunca "em texto puro";
  - o **público** fica em claro para a tela: titular, CNPJ, série, validade e o ID de cada CSC;
  - **um CSC por ambiente** (homologação e produção têm ID e valor diferentes) — a emissão pega o
    do ambiente da config;
  - vale **por loja ou para a rede**: o CSC e o certificado são da empresa (o portal da SEFAZ-RJ
    diz "o CSC é único para empresa"); a credencial da loja, se existir, tem prioridade;
  - o certificado é conferido **antes** de guardar: senha, se é e-CNPJ, validade e se a **raiz do
    CNPJ** é a do emitente (rejeição **213** da SEFAZ);
  - o .pfx vem com a cadeia da autoridade: o certificado usado é o que **casa com a chave
    privada**, não o primeiro do arquivo;
  - as rotas de cadastro são **só-nuvem** e só do presidente; a auditoria registra titular, série
    e validade — nunca o arquivo, a senha ou o CSC.
- **Assinatura (etapa B)** — `assinatura.ts`, com `xml-crypto`: enveloped, só o `<infNFe>` (URI
  `#NFe<chave>`), C14N 1.0 inclusiva, RSA-SHA1, digest SHA-1, um `X509Certificate`. Ordem dentro
  de `<NFe>`: `infNFe` → `infNFeSupl` → `Signature`. O teste confere cada assinatura também por um
  caminho SEM a biblioteca (C14N reconstruída para o XML do nosso builder) — com aspas, `&`, `<`,
  `>`, acentos e apóstrofo no nome do produto; sabotar a regra das aspas faz o teste reprovar.
- **Conexão com a SEFAZ (etapa C1)** — `sefaz/soap.ts`: SOAP 1.2 com a ação no Content-Type, o
  **certificado A1 no aperto de mão TLS** e o servidor **verificado pela raiz ICP-Brasil v10**
  (`sefaz/icp-brasil.ts`). O Node não traz essa raiz (ela não está na lista da Mozilla), e a
  saída é somá-la às raízes do Node SÓ nestas conexões — nunca desligar a verificação. A raiz
  foi baixada do repositório do ITI, provada criptograficamente contra a cadeia que a SVRS
  apresenta e conferida pelo SHA-256 publicado; o teste reprova se ela for trocada.
  Endereços da SVRS copiados do portal oficial; **UF sem autorizador confirmado é recusada**
  (hoje só o RJ). Falhas separadas: "SEFAZ não respondeu" (503) × "SEFAZ recusou" (502).
  Botão **"Testar conexão com a SEFAZ"**: consulta de status, sem emitir nada.
- **"Testar certificado"** — assina uma NFC-e de exemplo com o certificado GUARDADO e confere,
  sem SEFAZ e sem gravar nada: senha, chave de proteção e formato do .pfx aparecem antes da
  primeira transmissão.
- **Autorização (etapa C2)** — `sefaz/autorizacao.ts`: `nfeAutorizacaoLote` com **um lote de uma nota**
  e **`indSinc=1`** (assíncrono com nota única é rejeição **452**). A resposta tem dois níveis, e os dois
  são lidos: o do LOTE (`retEnviNFe`) e o da NOTA (`protNFe`) — `104` no lote só quer dizer "processei".
  Autorizada é **100, 120 ou 150**; o que fica guardado é o **`nfeProc`** (nota + protocolo), que é o
  documento que vale. `103` ("lote recebido") não é autorização: fica **pendente**.
- **Nunca "autorizada" por otimismo:** a nota nasce `pendente` e só muda com resposta da SEFAZ. Sem
  resposta (rede caiu depois do envio) ela **continua pendente** — pode ter sido autorizada lá — e a
  venda é impedida de emitir de novo às cegas, que duplicaria o documento.
- **Homologação:** o primeiro item sai com a frase obrigatória `NOTA FISCAL EMITIDA EM AMBIENTE DE
  HOMOLOGACAO - SEM VALOR FISCAL` (rejeição **373** sem ela). O resto da nota é idêntico ao de produção.
- **QR Code v3 no RJ** (NT 2025.001): o parâmetro é só `chave|3|tpAmb` — **sem CSC**. Por isso o CSC
  deixou de ser exigido no pré-voo quando a UF está na v3. A versão é por UF (`qrVersaoNfce`), porque
  UF que ainda não aceita a v3 rejeita com **407**.
- **Responsável técnico** (`<infRespTec>`, NT 2018.005): é a DISTRIBUIÇÃO, não a loja — vem das
  variáveis `RESP_TEC_*` do servidor e o lojista não vê nem edita. Sem elas o grupo não sai; se a UF
  exigir, a SEFAZ rejeita com **972** e aí elas passam a ser obrigatórias.
- **NFC-e de teste**, só em homologação e só do presidente: um item de R$ 1,00, sem comanda e sem
  impressão, na **mesma série e no mesmo contador** das vendas da loja. Serve para a primeira conversa
  real com a SEFAZ sem inventar venda; devolve o que a SEFAZ respondeu, inclusive a rejeição.
- **Série usada em homologação não vai para produção:** o contador é por série, não por ambiente — a
  produção começaria no número seguinte ao último teste, e os números dos testes seriam, para o Fisco,
  buraco na sequência de produção. A reserva recusa e manda usar outra série (ERR-085).
- **O XML é validado contra o SCHEMA OFICIAL nos testes** (`nfce-xsd.spec.ts`, XSDs do pacote
  PL_009_V4 em `backend/src/modules/fiscal/xsd/`, sem edição): venda simples, nota com frete,
  desconto, complemento e responsável técnico, e a de homologação. Motivo: a primeira nota
  transmitida foi rejeitada com **225 — Falha no Schema XML** apontando `enderEmit/cPais`, e o
  elemento apontado não era o errado — era o que apareceu **no lugar** do que faltava. Cada
  descoberta dessas na SEFAZ custa um número gasto; no teste custa 40 segundos. Confere forma,
  ordem e tipo — regra de negócio da SEFAZ (duplicidade, CSC, horário) continua sendo outra coisa.
- **`CEP` do emitente é obrigatório** (TEnderEmi 1-1, 8 dígitos) e vem **antes** de `cPais`:
  sai sempre no XML e é exigido no pré-voo, antes de reservar número (ERR-086).
- **`xCpl` (complemento, "LOJA 02")** era recebido da configuração e nunca escrito — o endereço
  da nota saía diferente do cadastrado na SEFAZ. Agora sai quando existe.
- **A nota `pendente` se resolve pela CONSULTA (P18)** — `sefaz/consulta-protocolo.ts`:
  `nfeConsultaNF` pela **chave**, que funciona mesmo quando a conexão caiu antes de qualquer
  recibo chegar (por isso não é a consulta por recibo, `NFeRetAutorizacao4`). O que a SEFAZ
  responde decide: **100/150** autorizada (grava protocolo e monta o `nfeProc`), **101/135/151/155**
  cancelada, **110/301/302** denegada — número CONSUMIDO, nunca volta —, **217** "não consta na
  base" (nunca registrada: o número está livre), e qualquer outro código é **indefinido**: não se
  decide nada, a nota segue pendente e tenta de novo.
- **Carência de 2 minutos para acreditar no 217.** A autorização é síncrona, mas o NOSSO tempo
  pode estourar enquanto a SEFAZ ainda processa — perguntar no segundo seguinte pode ouvir "não
  existe" de uma nota que está nascendo. Os outros desfechos são definitivos a qualquer momento.
- **Gravação condicional** (`where status = 'pendente'`): duas consultas simultâneas, ou o job e o
  botão ao mesmo tempo, não se atropelam — quem chegou primeiro decide.
- **Job a cada 5 min**, na loja E na nuvem (ao contrário da maioria dos crons — ver ERR-075):
  cada lado só consegue resolver as notas que ele emitiu. O recorte é a ORIGEM da série
  (`fiscal_serie`), então um lado nunca mexe na pendência do outro. Limite de tentativas e
  intervalo entre consultas para não girar em falso.
- **A venda deixou de travar na pendência:** ao emitir, se a comanda tem nota pendente, ela é
  consultada primeiro — autorizada devolve aquela nota (nunca emite a segunda), "não consta"
  libera para emitir de novo, e indefinido continua recusando (duas notas para a mesma venda é
  o pior desfecho possível).
- **INUTILIZAÇÃO (P19)** — `sefaz/inutilizacao.ts`, migs 282 (tabela) e 283 (gatilhos de sync):
  pedido `inutNFe` **assinado** (Id de 41 dígitos: cUF+ano+CNPJ+mod+série+nNFIni+nNFFin),
  `102` = homologada, e o que fica guardado é o **procInutNFe** (pedido + protocolo), que é o
  comprovante. A tela mostra as **lacunas em faixas** e o aviso do prazo; só o presidente pede.
- **O que conta como lacuna:** número sem documento válido. Nota `pendente` NÃO entra — enquanto
  não se sabe o que a SEFAZ fez, aquele número não se inutiliza (nem se reaproveita). Antes de
  enviar, a faixa é conferida contra o banco: se houver nota ocupando um número, recusa — a
  inutilização é IRREVERSÍVEL.
- **Sem resposta da SEFAZ no pedido:** fica `pendente` (ela pode ter homologado), e um pedido
  novo para a mesma faixa continua barrado — repetir daria 563.
- **Recuo entre consultas (rejeição 656).** O MOC (Anexo I) limita: *"NF-e consultada mais de 10
  vezes em 1 hora: contribuinte ficará com o WS de Consulta Protocolo recebendo a rejeição 656
  por até 1 hora para todas as requisições"* (CNPJ + IP). O intervalo fixo de 5 min dava 12/hora
  e derrubaria a consulta da empresa inteira; virou escada (10, 30 min, 2, 6, 12, 24 h) — no
  máximo 3 consultas na primeira hora. O botão da tela usa a MESMA conta. Ver ERR-088.
- **DUAS NOTAS PARA A MESMA VENDA (P20)** — `sefaz/evento-cancelamento.ts`, mig 284. O MOC (§3.5)
  descreve o caso que o nosso próprio fluxo cria: a nota ficou sem resposta, a consulta disse
  "não consta", emitimos a segunda — e a primeira aparece autorizada depois. Por isso a nota
  rejeitada **por 217** continua sendo consultada enquanto o prazo corre (168 h): é a única
  forma de flagrar a autorização tardia a tempo. Rejeitada por outro motivo está encerrada e
  nenhuma consulta a reabre.
- **Evento 110112:** cancela a nota que NÃO acobertou a operação (a mais antiga) referenciando
  em `chNFeRef` a que o cliente levou. Campos exclusivos dele — `cOrgaoAutor`, `tpAutor=1`,
  `verAplic` — e assinatura no `<infEvento>`, dentro de `<evento>` (não na raiz do lote).
  `135` (ou `155`, fora de prazo aceito pela UF) registra; qualquer outro código NÃO cancela, e
  a nota continua valendo. Fora das 168 h a rota recusa antes de enviar — a SEFAZ devolveria
  **501** e a explicação ao lojista seria pior.
- **`csc_token` em texto puro foi esvaziado** na mig 279: desde a mig 278 a `fiscal_config` desce
  para as lojas, e o segredo seria copiado para cada uma.

---

### 5.1 D9 — número não se reaproveita (decisão revista em 22/09/2026)

O plano inicial do P19 era devolver à fila o número da nota rejeitada. **O MOC 7.0 veda**, no
Anexo III, nota 2 (literal): *"a manutenção do número e série somente se aplica para os casos de
rejeição da NF-e que foi emitida em contingência, e **nunca** para os casos em que a NF-e foi
normalmente emitida mas o contribuinte não obteve êxito na consulta sobre o resultado da
autorização (as NF-e pendentes de retorno)"*. E manda o que fazer no lugar: *"inutilizar a
numeração das NF-e Pendentes de Retorno que não foram autorizadas ou denegadas"*. O Anexo IV
repete para a NFC-e: *"é vedada a reutilização, em contingência, de número de NFC-e transmitida
com tipo de emissão 'Normal'"*. Por isso a numeração **anda para a frente** e o buraco é fechado
por inutilização — nunca reusado.

---

## 7. Dependências NÃO confirmadas

> Nada daqui pode virar código como se fosse verdade. Ao confirmar, mover para a seção certa e
> registrar no §8.

| # | Pendência | O que fazer |
|---|---|---|
| P1 | **Rejeição 1115 (UB12-10): duas leituras.** O PDF da NT 2025.002 **v1.51** mantém 03/08/2026 em produção (CRT 3), e o CGIBS confirmou publicamente. Consultorias (TOTVS e escritórios) dizem que a v1.51 **adiou a rejeição sem nova data** | Baixar o PDF oficial da NT e conferir antes de decidir prazo |
| P2 | **Tabela oficial `cClassTrib`** — os códigos 200047 / 410019 / 410020 batem em duas fontes independentes, mas o arquivo oficial não foi obtido | Baixar o Informe Técnico RT 2025.002 **v1.60** à mão |
| P3 | **`pCBS` de 2027** — "aguarda legislação" | Campo parametrizável por ano; revisar após 15/12/2026 |
| P4 | **Taxa de entrega PRÓPRIA** (motoboy da casa) — a lei condiciona a exclusão a "por plataforma digital"; escritórios leem de forma mais ampla. E em qual alíquota seria tributada | Divergência não pacificada |
| P5 | **Fórmula do rateio da gorjeta** (RIBS art. 399, §3º) em comanda mista | Redação ambígua, sem nota oficial |
| P6 | Se a vedação de crédito do art. 276 prevalece sobre o crédito do Simples (LC 123, art. 23, §2º) | Sem manifestação oficial |
| P7 | **Como imprimir IBS/CBS no DANFE** — a NT diz "em estudo" | Aguardar nova versão da NT |
| P8 | **Anexos do Imposto Seletivo** (NCM e `cClassTribIS`) — "tabela a ser publicada" | O grupo IS não é preenchível ainda |
| P9 | **Datas de obrigatoriedade do split payment** — nenhuma norma publicada; os manuais de 28/08/2026 são de habilitação de **PSPs**, não de PDV | Acompanhar `cgibs.gov.br/atos-tecnicos-conjuntos`; **não construir nada agora** |
| P10 | **Tabela de limites de NFC-e por UF** (anunciada na NT 2026.002) — não localizada publicada | Usar defaults, manter parametrizável |
| P11 | **Faixas de série reservadas para o modelo 65** | Não confirmado → evitar 890-999 |
| P12 | **URLs de QR Code das 27 UFs** | Preencher a partir do **Manual do DANFE NFC-e e QR Code v6.0**; até lá é configuração por loja, e sem ela a emissão é recusada |
| P13 | **Prazo de validade do CSC** na maioria das UFs | Só o mecanismo de expiração está documentado, não o prazo |
| P14 | Regras estaduais de **AC, AP, MA, PA, PB, PI, RN, RO, RR, SE, TO** | Sabe-se apenas que autorizam via SVRS |
| P15 | **`cIdToken` no QR: com ou sem zeros à esquerda** ("000001" × "1") — guardamos como digitado | Conferir no Manual do DANFE NFC-e e QR Code v6.0 antes de montar o QR real (etapa C) |
| P21 | **Contingência off-line (`tpEmis=9`)**: é o que impede o caixa de travar quando a SEFAZ demora — sem ela a nota nova também falha e, passados 5 min do `dhEmi`, vem a rejeição **704**. ⚠️ O uso é decisão de CADA UF e não achei fonte oficial dizendo que o RJ permite | Confirmar na legislação do RJ antes de implementar |
| ~~P20~~ | ~~Cancelamento por substituição~~ — **RESOLVIDO 23/09/2026** (mig 284): evento 110112, re-consulta da nota "inexistente" dentro das 168 h, lista de duplicidades com o prazo restante e cancelamento pela tela. | — |
| ~~P19~~ | ~~Número queimado~~ — **RESOLVIDO 22/09/2026** (migs 282/283): inutilização implementada; reaproveitamento descartado por vedação do MOC (ver §5.1). | — |
| ~~P18~~ | ~~Nota que fica `pendente`~~ — **RESOLVIDO 22/09/2026** (mig 281): consulta pela chave, carência de 2 min para o 217, job nas duas pontas e a venda consultando antes de emitir. | — |
| ~~P17~~ | ~~RJ → SVRS na NFC-e~~ — **RESOLVIDO 22/09/2026**: o "Testar conexão com a SEFAZ" com o certificado real trouxe **107 — Serviço em Operação** da SVRS para `cUF=33`. A SVRS só responde 107 para UF que atende. | — |
| ~~P16~~ | ~~.pfx exportado pelo Windows~~ — **RESOLVIDO 22/09/2026**: o certificado real da loja-piloto, exportado do Windows, foi cadastrado em produção e abriu no `node-forge`. O botão "Testar certificado" (etapa B) prova também a assinatura com ele. | — |

---

## 8. Changelog

| Data | O que mudou |
|---|---|
| 23/09/2026 | P20 (mig 284): cancelamento por substituição (evento 110112). A nota rejeitada por 217 passa a ser re-consultada durante as 168 h para flagrar autorização tardia; a tela mostra a duplicidade com o prazo restante. |
| 22/09/2026 | P19 (migs 282/283): inutilização de numeração, relatório de lacunas em faixas e recuo entre consultas (rejeição 656, ERR-088). Reaproveitamento de número DESCARTADO por vedação do MOC — ver §5.1. Abertas P20 (cancelamento por substituição) e P21 (contingência off-line). |
| 22/09/2026 | P18 (mig 281): a nota `pendente` passa a se resolver pela consulta à chave — rota, botão, job nas duas pontas e a venda consultando antes de emitir. Colunas `cstat`/`consultada_em`/`tentativas_consulta`, e a unicidade do número passou a ignorar as rejeitadas (base do P19). |
| 22/09/2026 | **PRIMEIRA NFC-e AUTORIZADA** (homologação, SVRS/RJ): nº 2 série 51, protocolo 333260002547395, "100 - Autorizado o uso da NF-e". Montagem, assinatura, QR v3, transmissão e leitura do protocolo provados de ponta a ponta com o certificado real. |
| 22/09/2026 | **Primeira transmissão real**: rejeição 225 (CEP do emitente faltando). Corrigido CEP + `xCpl`, CEP no pré-voo, e o XML passou a ser validado contra o XSD oficial na suíte (ERR-086). |
| 22/09/2026 | Etapa C2 do P2: **transmissão real** (`NFeAutorizacao4`, lote síncrono), leitura dos dois níveis de resposta, `nfeProc` guardado, QR v3 no RJ, frase de homologação, `infRespTec`, NFC-e de teste. P17 resolvido; P18 e P19 abertos. |
| 22/09/2026 | Etapa C1 do P2: conexão com a SEFAZ (SOAP 1.2, certificado de cliente, raiz ICP-Brasil v10), consulta de status. Pendência P17. |
| 22/09/2026 | Etapa B do P2: assinatura XML-DSig, grupo `infNFeSupl` com QR e `urlChave` (mig 280), "Testar certificado". P16 resolvido. |
| 22/09/2026 | Etapa A do P2: certificado A1 e CSC cifrados (mig 279), leitura do .pfx, tela de cadastro. Pendências P15 e P16. |
| 21/09/2026 | Documento criado. Pesquisa de 20/09/2026 consolidada; auditoria do emissor; decisões D1-D8; mig 278 (emissão *fail-closed* + série por origem). |
