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
>
> **⚠️ Base ampliada em 23/09/2026 — skill global `cupom-fiscal`** (`~/.claude/skills/cupom-fiscal/`):
> as **27 UFs** levantadas em fonte oficial, capítulo técnico nacional, reforma tributária, tributação
> e obrigações, e o registro de **conflitos entre fontes**. Este doc passa a ser o recorte do *nosso*
> emissor; **o que vale para qualquer projeto está lá**, e a skill é a fonte mais nova.
> Leitura obrigatória antes de mexer em tributo: `referencias/06-conflitos-e-achados-transversais.md`.

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
| Validação do XML contra o **XSD oficial** dentro da suíte | Existe — `nfce-xsd.spec.ts`. ⚠️ **Usamos o `PL_009_V4`; o vigente é o `PL_010f_v1.04` (31/08/2026)** — e ele traz só o leiaute: web services e eventos vêm em pacotes separados (não existe pacote "tudo em um") |
| **NFC-e AUTORIZADA pela SEFAZ** (homologação, SVRS/RJ) | ✅ 22/09/2026 — nº 2, série 51, protocolo `333260002547395`, cStat 100 |
| Consulta da situação pela chave (`NFeConsultaProtocolo4`) + resolução da nota `pendente` | Existe — `sefaz/consulta-protocolo.ts`, rota, botão e job (P18) |
| **Inutilização** de numeração (`NFeInutilizacao4`) + relatório de lacunas | Existe — `sefaz/inutilizacao.ts`, migs 282/283 (P19) |
| Reaproveitamento de número | **NÃO EXISTE — e não vai existir**: o MOC veda (ver §5.1) |
| Cancelamento por substituição (evento 110112, 168 h) | Existe — `sefaz/evento-cancelamento.ts`, mig 284 (P20) |
| Contingência off-line `tpEmis=9` (fila + efetivação) | NÃO EXISTE — **mas o bloqueio caiu: o RJ PERMITE** (P21 resolvida, §7) |
| Grupos IBS/CBS/IS (reforma) | NÃO EXISTE |

**O emissor já fala com a SEFAZ de verdade**: monta, assina, transmite e só grava "autorizada" com
protocolo na mão. P18 (nota pendente), P19 (número queimado) e P20 (cancelamento por substituição)
estão **feitos**. O modo simulado continua recusado em produção (§5).

**Falta para produção, em ordem de risco:**

| # | O que | Por quê |
|---|---|---|
| 1 | **Contingência off-line (`tpEmis=9`)** | sem ela o caixa trava quando a SEFAZ demora, e passados 5 min do `dhEmi` a nota nova também é rejeitada. **O RJ permite** — o bloqueio era só de confirmação |
| 2 | **Tratamento da denegação está errado** | não existe mais denegação por emitente irregular na NFC-e: virou **rejeição 781**, que **não consome número**. Hoje avançamos o contador à toa — ver §6 |
| 3 | **Limite de identificação do consumidor** | usamos o default nacional; **no RJ é R$ 2.000** e nenhuma UF usa R$ 10.000 — ver §2 |
| 4 | **Entrega do certificado ao servidor LOCAL** | recifrado com a chave dele |
| 5 | **Grupos IBS/CBS** | ver §4 |

---

## 2. O que é nacional — pode ser constante no código

Base: **Ajuste SINIEF 19/16**, texto compilado (inclui até o Ajuste 9/26) —
https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16

- **Numeração:** 1 a 999.999.999, **por estabelecimento E por série** (cl. 4ª, II).
- **Série:** algarismos arábicos, ordem crescente; **série única = 0**; **subsérie vedada** (cl. 4ª, §1º).
  **Não existe faixa de série reservada para contingência** — o inciso que exigia 501-999 foi
  revogado pelo Ajuste 26/19, e a redação anterior (890-989) está "sem efeitos".
  🔴 **MAS ISSO É SÓ O NACIONAL: o RN reserva 890-989 para contingência desde 01/03/2020.** Uma UF
  pode manter exigência própria depois de o texto nacional cair ⇒ **nunca usar séries de 890 a 989**,
  em UF nenhuma.
- **Quantidade de séries:** sem teto nacional; "o Fisco **poderá** restringir" (cl. 4ª, §2º).
- **Comunicar série à SEFAZ:** não é preciso. Nenhuma SEFAZ homologa software, impressora ou série —
  **salvo SC** (PAF-NFC-e credenciado).
- **Cancelamento:** ≤ **30 minutos**, sem saída da mercadoria; **168 h** quando substitui nota emitida
  em contingência (cl. 15ª e 15ª-A). Cancelamento é **evento**, nunca *delete*.
  A redação de **24 h** que ainda circula está **revogada desde 01/10/2018** (Ajuste 7/18).
- **Inutilização:** números não usados, até o **10º dia do mês subsequente** (cl. 16ª).
  **A partir do 11º dia, quebra de sequência sem inutilização é presumida como "documento emitido em
  contingência e não transmitido"** (cl. 11ª, §5º). Número pulado e esquecido vira presunção de omissão.
- **Contingência off-line:** transmitir até o **1º dia útil subsequente** (MOC 7.0 Anexo IV);
  **proibido** reaproveitar número já transmitido como "Normal" e **proibido** inutilizar número
  emitido em contingência (cl. 11ª, §2º). O DANFE off-line fica à disposição do Fisco até autorizar.
- 🔴 **A DENEGAÇÃO ACABOU PARA A NFC-e.** Emitente em situação irregular não gera mais documento
  denegado: virou **rejeição 781** (Ajuste SINIEF 10/2023 + NT 2023.002; produção até **04/09/2023**).
  **Denegação consome o número; rejeição não.** A eliminação é **parcial**: o `301` (emitente) pode
  sair do código; `302`/`303` (destinatário/transportador) não foram nominalmente eliminados e o
  `110` fica como defesa. Ver §6 — **o nosso emissor ainda trata 110/301/302 como denegada.**
- **Não existe CC-e para NFC-e.**
- **Devolução ≠ cancelamento:** devolução pelo consumidor se resolve com **NF-e modelo 55 de entrada**.
- **Guarda:** XML por **5 anos**, sob responsabilidade do emitente. O DANFE não precisa ser guardado.
- **Escrituração (EFD):** modelo "65", **uma NFC-e por vez em C100 + C190**, pela **data de emissão**
  (mesmo que a autorização venha depois), **só nas saídas**.
  🔴 **CORREÇÃO (23/09/2026) — "canceladas e inutilizadas entram sem valores" estava ERRADO:**
  **cancelada** entra (C100 com `COD_SIT` 02/03, 8 campos + chave, o resto `||`, sem filhos);
  **inutilizada e denegada NÃO entram** — o código 05 foi **descontinuado desde janeiro/2023**.
  **`C170` não entra** (item de cupom não vai para a EFD) e **não existe escrituração consolidada
  para o modelo 65** (consolidação por equipamento é do SAT e do ECF).
  Fonte: **Guia Prático da EFD ICMS/IPI 3.2.4** (Ato COTEPE/ICMS 86, de 09/09/2026), leiaute **020**
  — a 021 só vale a partir de 01/01/2027. ⚠️ `sped.rfb.gov.br` está parado na 3.2.2; a fonte viva é
  `gov.br/sped`.
- **Limites — 🔴 NÃO SÃO CONSTANTES, são configuração por UF, e isso agora é norma nacional:**
  a regra de validação **W16-40** passou a dizer *"superior a R$ 10.000,00 **ou outro valor definido
  pela UF**"*, **em produção desde 15/06/2026**, com tabela por UF anunciada. Vale para os dois
  limites (teto de R$ 200.000 e piso de identificação). **Limite literal no código está em desacordo
  com a norma vigente, não apenas desatualizado.**
  **E nenhuma UF levantada usa o default de R$ 10.000:**
  CE **R$ 200** · BA, AL, PB **R$ 500** · MT **R$ 1.000** · **RJ R$ 2.000** · TO **R$ 3.000** (com
  nome e endereço) · PE **R$ 5.000**. O default do sistema tem de ser o **mais restritivo conhecido**.
  Desde **03/08/2026 (Ajuste 9/26**, o último a alterar o 19/16), CPF/CNPJ **e endereço** em **toda
  operação não presencial** — e isso alcança **delivery, app, marketplace e até pedido online com
  retirada na loja**. ⚠️ Nosso delivery e nosso pedido online estão dentro.
  ⚠️ A RV **W16-60** (endereço, rejeição **752**) aparece como `Obrig.` na NT enquanto a observação
  herdada ainda diz "opcional a critério da UF" — tratar como **exigível** é a posição segura.
- **Intermediador:** a nota deve conter o **CNPJ do intermediador/agenciador** (cl. 4ª, XII) —
  iFood, 99Food, marketplaces.
- **NFC-e com destinatário CNPJ voltou a ser permitida:** o Ajuste 11/25 foi **revogado** pelo
  **Ajuste 12/26** (DOU 09/04/2026). Se algum ponto do código bloqueia CNPJ, está errado.

---

## 3. O que varia por estado — tem de ser configuração por loja, nunca literal

| Parâmetro | Variação |
|---|---|
| **Autorizador** | 7 próprios (AM, GO, MS, MT, PR, RS, SP) + **SVRS** para as demais. 🔴 **MG está em CONFLITO entre fontes** (própria × SVRS) — só o `NFeStatusServico4` com `cUF=31` esperando `107` decide; até lá, recusar. ⚠️ **RS tem dois domínios não intercambiáveis**: `nfce.sefazrs.rs.gov.br` (emitente gaúcho) × `nfce.svrs.rs.gov.br` (as outras UFs). **AM** não usa `.asmx` |
| **URL do QR Code / consulta** | por UF e por ambiente. O IT 2025.003 mudou só a de **GO** |
| **CSC** | quantidade (**2 por ambiente** em PR/DF/PE/RJ/SC/MS; **BA** 1 homologação + 2 produção), escopo (CNPJ raiz × por estabelecimento × **"todos no estado"** em MG; **CNPJ base de 8 dígitos** no PR), **ID Token fixo `000001` no ES**, e **vigência com início/fim** (a tela de **SE** exibe "Data Início/Data Fim" — indício de **CSC que expira**). 🔴 **Onde só cabem 2 e os dois estão ocupados, gerar um novo exige INUTILIZAR um existente — e inutilizar o CSC que outro emissor usa derruba a emissão dele na hora** |
| **Contingência** | **NFC-e NÃO tem SVC** (rejeição **783**) — SVC-AN/SVC-RS é do modelo 55. A modalidade é a **off-line `tpEmis=9`**, e o uso é **decisão de cada UF** (rejeição **712** onde não vale). Prazo: **1º dia útil subsequente** no **RJ** e na maioria; **PR** e **PB** em **24 h**. **SP** só liberou em jul/2024 (Portaria SRE 40/2024). 🔴 **TO impõe teto de 10% das NFC-e do mês em contingência** — passar disso autoriza revogar o credenciamento, e o descredenciado **volta a ser obrigado a ECF**; exige ainda **DANFE em 2 vias** |
| **Cancelamento extemporâneo** | quatro desenhos: **existe com sistema próprio** (RJ, reabertura de prazo) · **mediante requerimento** (SE, motivado; AL, a critério do fisco; MT, **com taxa**, até o 5º dia útil do mês seguinte) · **prazo estendido** (**AM: 90 dias**) · **não existe** (MG, SP, DF, PE "não adota") — sobra denúncia espontânea/SIPET, **BA** com NF de regularização em **60 dias** e **ES** com NF-e 55 de estorno |
| **Limites** | ver §2 — **parametrizáveis por UF por norma nacional** (RV W16-40, em produção desde 15/06/2026). **Nenhuma UF usa o default de R$ 10.000**: CE R$ 200 · BA/AL/PB R$ 500 · MT R$ 1.000 · **RJ R$ 2.000** · TO R$ 3.000 · PE R$ 5.000. `indPres=4` pode ser **bloqueado pela UF** |
| **Credenciamento** | automático (RJ, AM, PA, **AL** — virou de ofício por norma recente, embora o site ainda descreva o rito antigo) × por pedido (SP, MS, MG, PE, AP, RO, RR, TO); por **CNPJ** (RJ, BA) × por **estabelecimento** (SP, PR); com **homologação formal** em **PE** (produção só depois de **10 notas de teste** autorizadas) e MS. 🔴 **RR e TO são IRRETRATÁVEIS** — em RR a adesão se consuma **na 1ª nota autorizada em produção**: um teste por engano credencia a loja para sempre |
| **Software credenciado** | 🔴 **SC e PA** — não é só SC. **SC (PAF-NFC-e):** sem ser **desenvolvedora credenciada** na SEF-SC, **nenhuma loja catarinense emite**; desde 31/01/2025 é a **própria desenvolvedora** que credencia o lojista, e **desvincular corta a emissão na hora**; exige laudo por órgão técnico; sanção até **cassação** (derruba toda a base do estado); impõe **requisitos funcionais de PDV** (mesa aberta, transferência entre mesas, vedação de excluir itens, acumulação por meio de pagamento e **por intermediador**) — e a v03.00.00 trocou o relatório impresso de conferência de mesa pelo **Arquivo V** (XML). **PA:** o software precisa ser credenciado na SEFA; ERP não cadastrado = **multa de 2% do faturamento** do período |
| **Série "0"** | Nacional e BA: permitida **só** para série única. **ES e AL publicam que o zero é vedado.** → **nunca usar a série 0** |
| 🔴 **Vincular o PAGAMENTO ao documento** | **virou tendência, já são 5 UFs. GO** (IN 1.608/2025): grupo **YA** com CNPJ/CPF do beneficiário, **código de autorização**, data/hora, valor e **identificador do terminal**, inclusive **PIX**, "sem intervenção manual" — cronograma **prorrogado 3×**, redação vigente de 25/08/2026: 01/11/2025 (>R$ 4,8 mi, varejo) · 01/06/2026 (>R$ 4,8 mi, demais) · 01/11/2026 (R$ 360 mil–4,8 mi) · **01/02/2027** (até R$ 360 mil); **MEI fora**, **delivery e plataforma expressamente fora**. **PE:** art. 149-A vincula o TEF à NFC-e. **CE:** art. 77 §3º, interligação tecnológica. **PB:** `tpIntegra`=1 e **NFC-e impressa ANTES do comprovante do TEF**. **RS:** vinculação do comprovante + **NFC-e obrigatória / NF-e 55 vedada** desde 01/06/2026. ⚠️ **Consequência para nós:** o PDV tem de **receber de volta os dados da autorização do TEF/PIX antes de imprimir** — é arquitetura de integração, não campo de XML |
| 🔴 **Documento impresso além do DANFE** | **CE** (art. 82) exige o não fiscal **"Detalhamento de Vendas"** antes do DANFE; **RN** exige DANFE **completo** com a seção **"Detalhe de Venda"**. Emissor que só imprime o DANFE padrão **reprova** nessas UFs |
| 🔴 **FCP** | **não é um percentual, são 4 decisões por UF**: alcance por produto (em **MT** cerveja/chope TÊM e destilado/vinho NÃO) · momento (**AM não cobra no varejo** — tratar como FCP normal **cobra em duplicidade**; **TO** recolhe em guia separada) · **se já está embutido na alíquota publicada** (**PE** e **SE** sim, **CE** soma por fora ⇒ "alíquota + 2" cobra 2 p.p. a mais em PE e SE) · forma de declarar (**5 jeitos**; o **RS não usa os campos `vFCP`/`pFCP`**, e o **RJ** exige declarar **até quando não incide**). **Sem fundo: AC, AP, PA, RR, SC** |

**Nenhuma UF usa outro documento hoje** — confirmado em 23/09/2026, **sem prorrogação em nenhum dos
dois casos**. SP: a **Portaria SRE 79/2024** acrescentou o art. 34-D à Portaria CAT 147/2012 ("vedada
a emissão do CF-e-SAT a partir de 1º/01/2026"); ⚠️ o que foi revogado (pela SRE-92/24) é o art.
**34-C** (proibição de ativar novos SAT), não a vedação — e **o SAT NÃO virou contingência**: a de SP
é off-line + EPEC em host próprio. CE: o **Decreto 36.417/2025** acrescentou o art. 76-A ao Decreto
35.061/2022, e ali o **MF-e continua previsto como contingência da NFC-e** (art. 83, I), embora
esvaziado. **ECF não tem prazo nacional** — a vedação é estadual.

---

## 4. Calendário — reforma tributária no cupom

Fontes: NT 2025.002-RTC v1.51; Ato Conjunto RFB/CGIBS nº 4, de 30/07/2026; LC 214/2025 (com LC 227/2026);
Decreto 12.955/2026 (RCBS); Resolução CGIBS nº 6/2026 (RIBS).

| Data | O que acontece | Alcança quem |
|---|---|---|
| ~~03/08/2026~~ 🔴 **SEM DATA** | Grupo `IBSCBS` obrigatório em todo item — **a NT 2025.002 v1.51 RISCOU as datas** (03/08/2026 para CRT 3 e 04/01/2027 para Simples/MEI). Texto vigente da RV **UB12-10**: *"Implementação futura"*. A obrigação **legal** existe desde 01/01/2026; a **técnica**, não. Quase toda consultoria ainda publica as datas antigas | — |
| **05/10/2026** ⚠️ **em 12 dias** | **`cStat 120`** ("autorizado com alerta", **só NFC-e**) entra em produção, com a RV `5E17-65`. Alertas no grupo **PR13** (`cMsg`/`xMsg`, até 5) — e **rejeição também devolve os alertas já coletados** | todos |
| **31/12/2026** 🔴 | **Vence o benefício de bar e restaurante no país inteiro**: Convênios ICMS **91/2012** e **09/1993** prorrogados só até lá (Conv. ICMS 21/26). No **mesmo dia** vencem **SC** (carga 3,2% → volta a 12%) e **SP** (regime de 4%) | **o nosso ramo-âncora** |
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
1. **O XSD não protege.** `IBSCBS` é `minOccurs="0"` no schema — **provado**: linha 5186 do
   `leiauteNFe_v4.00.xsd` no `PL_010f_v1.04`. A validação local passa e a SEFAZ rejeita com **1115**.
   O portão tem de ser teste de domínio, não de schema. (A **data** da 1115 caiu — ver a tabela.)
2. **`cStat = 120` ("Autorizado o uso da NF-e, com alerta") é SUCESSO** — NT 2026.002 **v1.10a**,
   §2.1, **inicialmente só para NFC-e**, **produção em 05/10/2026**. Quem tratar como erro cai em
   contingência e **duplica a venda**. Sucesso = `100 | 120 | 150`; `if (cStat != 100)` é o bug
   clássico. ⚠️ **O `120` vence o `150`**: nota autorizada fora de prazo **que também tenha alerta**
   volta como 120. E **quem não lê o grupo PR13 recebe o 120, trata como sucesso silencioso e perde
   o aviso da SEFAZ** — a única RV de alerta hoje (`5E17-65`, msg 172) é "CNPJ do destinatário
   irregular/bloqueado", ou seja, dispara justamente no cliente PJ que pede o CNPJ no cupom.
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
  e **`indSinc=1`**. ⚠️ **A justificativa registrada aqui ("assíncrono com nota única é rejeição 452")
  precisa ser reconferida**: o levantamento de 23/09/2026 indica que a **452 é do modelo 55** e que,
  na NFC-e, lote com mais de uma nota rende **126/961** (NT 2023.002). O comportamento do nosso
  código está **provado em campo** (nota autorizada), então **não mexer** — só corrigir o motivo
  citado quando confirmado no MOC consolidado. A resposta tem dois níveis, e os dois
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
  **PL_009_V4** em `backend/src/modules/fiscal/xsd/`, sem edição — 🔴 **o vigente é o `PL_010f_v1.04`,
  de 31/08/2026; atualizar**): venda simples, nota com frete,
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
  🔴 **A CORRIGIR (descoberto em 23/09/2026):** esse ramo está **desatualizado**. A denegação por
  irregularidade do EMITENTE **foi eliminada na NFC-e** e virou **rejeição 781** (Ajuste SINIEF
  10/2023 + NT 2023.002, produção até 04/09/2023). **Rejeição NÃO consome número** — então hoje,
  nesse caso, **avançamos o contador à toa** e depois teremos de inutilizar numeração que nunca
  precisou ser queimada. Mudança mínima: tratar **781** como rejeição que **libera o número**, e
  manter `302`/`303`/`110` no ramo de denegação (não foram nominalmente eliminados). Indício forte
  de que o destinatário também não denega mais: a NT 2026.002 trata "destinatário CNPJ irregular"
  como **alerta 172 + cStat 120**, ou seja, **autorizando**.
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
- **DESTINATÁRIO, ENTREGA E INTERMEDIADOR** — `fiscal/destinatario.ts`, mig 285. Uma venda de
  delivery sai de dois jeitos, e a escolha muda cinco campos do XML:
  - **`indPres=4`** (entrega a domicílio) quando há documento do cliente **e** endereço com
    bairro: sai `dest` + `enderDest` + `transporta`, e a taxa vai como **frete**. Faltando
    qualquer peça, não se declara entrega — seria 787 (sem destinatário), 788 (sem endereço) ou
    786 (sem transportador), e rejeição gasta número.
  - **`indPres=1`** no resto. Aí frete e transportador são **proibidos** (753 e 754) e a taxa de
    entrega entra como **`vOutro`** — despesa acessória, que compõe o `vNF` (W16-10) e não pede
    NCM. Item novo pediria, e NCM `"00"` fora de item de serviço é rejeição **471**.
  - **Pedido não presencial sem CPF**: escolha da loja (`fiscal_config.delivery_sem_cpf`),
    padrão `presencial`. Venda sem nota é infração; nota sem o CPF que o cliente não deu, não.
  - **Transportador = a própria loja**, conforme o manual da NFC-e da SEFAZ-RJ: *"quando o
    transporte for feito pela própria empresa, os dados da empresa devem constar no campo dados
    do transportador, independentemente se quem realiza o transporte é um motoboy, ciclista"*.
  - **`indIntermed` sai SEMPRE** (B25c-10 → 434, produção desde 04/04/2022): `0` na venda
    própria, `1` + `infIntermed` (CNPJ do canal + `idCadIntTran` = `integracao.merchant_id`) no
    marketplace. **Sem o CNPJ do canal cadastrado, o pedido dele NÃO é emitido** — declarar `0`
    seria informar à SEFAZ que a venda foi direta (ver P26).
  - **Limite de identificação parametrizado** (`LIMITE_IDENTIFICACAO_UF` + `limite_identificacao`
    por loja). UF fora da tabela usa o piso **mais restritivo** conhecido, não os R$ 10.000.
  - **Documento do cliente sempre conferido** (dígito verificador) antes de entrar no XML: CPF
    digitado errado vale como ausente, em vez de virar rejeição 237 com número gasto.
  - **No cardápio do Regem o CPF é opcional**: só quem marca "quero cupom fiscal" informa — e aí
    o campo passa a ser obrigatório e validado. Nos canais externos, lê-se o documento do próprio
    payload. O DANFE impresso passa a dizer `CONSUMIDOR: …` ou `CONSUMIDOR NAO IDENTIFICADO`.
- **DENEGAÇÃO ≠ REJEIÇÃO, E O QUE SEPARA AS DUAS É O NÚMERO** — `sefaz/autorizacao.ts`. A nota
  **denegada é gravada na base da SEFAZ** (quem tentar de novo recebe **205**, "NF-e está
  denegada na base de dados"): o número está consumido para sempre, não se reaproveita **e não
  se inutiliza** — a SEFAZ recusa inutilização de numeração que ela já tem. A **rejeitada**
  nunca entrou na base: o número segue livre e, como a nossa numeração só anda para a frente
  (§5.1), vira lacuna a inutilizar. Até agora a denegação vinda da AUTORIZAÇÃO era gravada como
  `rejeitada` — o número apareceria no relatório de lacunas e o lojista pediria a inutilização
  de um número que a SEFAZ já tem (ERR-094). A vinda da CONSULTA já estava certa (mig 281).
  - **A irregularidade do emitente chega das duas formas, e isso é da UF:** a regra **1C17-38**
    (55/65) devolve **781** "Emissor não habilitado para emissão da NF-e/NFC-e" como
    **rejeição**; a **1C17-40** (55/65) devolve **301** "Uso Denegado: Irregularidade fiscal do
    emitente" como **denegação**. As duas estão vigentes no MOC consolidado — não dá para
    escolher uma e ignorar a outra, e é por isso que os dois caminhos existem no código.
- **AVISO DA SEFAZ AO EMISSOR (`cMsg`/`xMsg`)** — grupo opcional dentro de `protNFe/infProt`,
  conferido no **XSD oficial** (`leiauteNFe_v4.00.xsd`, tipo `TProtNFe`: `cMsg` com até 4
  dígitos e `xMsg` com até 200 caracteres, logo depois de `cStat`/`xMotivo`). É como a SEFAZ
  fala sobre uma nota que ela **autorizou** — o caso do `cStat 120`. Agora ele é lido na
  autorização e na consulta, entra no `motivo` (que é o que a tela da nota mostra) e sai no log,
  porque nota autorizada ninguém vai reconferir depois. ⚠️ O `cStat 120` **não consta** da
  tabela 4.1 do MOC consolidado (ela salta de 112 para 124); ele vem de nota técnica, e a data
  de produção de 05/10/2026 é da skill, não do MOC — `ehAutorizado()` já o aceita desde antes.
- **CONTINGÊNCIA OFF-LINE — o caixa não para quando a SEFAZ fica muda** (`contingencia.ts`,
  `fiscal.service.ts`, mig 286). A venda sai com cupom válido, assinado, e a autorização vem
  depois. Ponta a ponta:
  - **Entra sozinha, e só pelo SILÊNCIO**: a nota enviada sem resposta fica `pendente`, o ponto
    de emissão entra em contingência e a MESMA venda sai numa nota nova, `tpEmis=9`. Rejeição
    **não** liga contingência — rejeição é a SEFAZ dizendo não, e no RJ um documento emitido com
    IE irregular é inidôneo *inclusive em contingência*.
  - **O número da nota pendente não volta** (Ajuste 19/16, cl. 11ª, §2º, I): a de contingência
    usa o seguinte, que é o que o Anexo IV recomenda. A pendente segue o caminho do P18/P20 —
    consulta, e então inutilização ou cancelamento por substituição.
  - **Enquanto está em contingência, nenhuma venda tenta a SEFAZ.** Era justamente a espera pelo
    *timeout* que travava o caixa; repetir a tentativa a cada venda devolveria o problema.
  - **Sai sozinha**: a cada 5 minutos o job pergunta o status do serviço (consulta que não emite
    nem gasta número). Voltando `107`, a contingência desliga.
  - **A fila é transmitida** pelo mesmo job, com o XML que já está gravado — mesma chave, mesmo
    `cNF` (Anexo IV, §3). Autorizada vira documento; **rejeitada CONTINUA na fila**, porque
    número emitido em contingência **não pode ser inutilizado** (cl. 11ª, §2º, II): ele tem de
    ser transmitido, corrigido e reenviado com a mesma numeração. Duplicidade (204) manda
    consultar pela chave em vez de adivinhar.
  - **Prazo: fim do primeiro dia útil subsequente** à emissão. A tela de notas mostra quanto
    resta por nota, e o log registra quando alguma passa do prazo. No RJ, não transmitir é
    **multa de 5% do valor da operação** (RICMS, art. 62-C, III) e transmitir fora do prazo,
    100 UFIR-RJ por obrigação (XIII) — por isso a fila não é acessório.
  - **DANFE**: sai com **"EMITIDA EM CONTINGENCIA"**. A **segunda via** ("VIA DO
    ESTABELECIMENTO", Anexo IV, §4) é **opcional e vem desligada** (mig 287): restaurante não
    arquiva cupom em papel, e o próprio manual dá a alternativa que nós já cumprimos por
    desenho — *"poderá optar pela guarda eletrônica, em local seguro, do respectivo arquivo XML
    da NFC-e… possibilitar a impressão do respectivo DANFE NFC-e para apresentação ao fisco
    quando solicitado"*. O XML assinado fica em `nota_fiscal.xml` desde a emissão, sobe para a
    nuvem e volta. ⚠️ O que **não** é software: para usar a guarda eletrônica, a loja "deverá,
    previamente, lavrar termo no livro Registro de Utilização de Documentos Fiscais e Termos de
    Ocorrência - modelo 6". Quem precisar do papel (UF que exija, ou termo ainda não lavrado)
    liga o interruptor na configuração fiscal.
  - **O estado é por PONTO DE EMISSÃO** (`tenant`, `unidade`, `origem`): a loja pode estar sem
    internet enquanto a nuvem emite normalmente. A tabela **não sincroniza** — sincronizar faria
    a nuvem, que está bem, desligar a contingência da loja que continua fora do ar.
  - Base do documento e do QR (parte 1):
  - `tpEmis=9` com **`dhCont` e `xJust`** como últimos elementos do `ide` — faltando qualquer um
    é rejeição **557** (B28-20); informá-los numa nota normal é **556** (B28-10). Os campos
    obrigatórios da contingência estão no **MOC 7.0, Anexo IV, §4**: `mod=65`, `dhCont`,
    `xJust`, `idDest=1`, `tpEmis=9`, `finNFe=1`, `indFinal=1`, `indPres=1`.
  - **O `tpEmis` é o 35º dígito da chave de acesso**: montar a chave como normal e declarar
    contingência no `ide` (ou o contrário) é uma nota que não fecha consigo mesma. O builder
    recusa antes de gastar o número.
  - **QR Code v3 OFF-LINE**, oito parâmetros (Manual do DANFE NFC-e e QR Code **v6.0, §4.4.2,
    Tabela 7**): `chave|3|tpAmb|DIA|vNF|tipoDest|dest|assinatura`. Sem destinatário, os campos 6
    e 7 ficam **vazios** e os separadores permanecem. A **assinatura é RSA-SHA1 em Base64 sobre
    os parâmetros 1 a 7 com os separadores**, feita com o mesmo A1 que assina a NFC-e — é ela
    que substitui o CSC na v3. Assinatura errada é rejeição **583** (ZX02-338); assinatura numa
    nota que **não** é de contingência é **445** (ZX02-330).
  - O DIA sai do **texto** do `dhEmi` (que já está no fuso da UF): passar por `Date` traria o
    fuso da máquina de volta e, perto da virada, o QR levaria o dia errado.
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
| ~~P1~~ | ~~Rejeição 1115: duas leituras~~ — **RESOLVIDO 23/09/2026**: o PDF oficial da NT 2025.002 **v1.51** foi lido e as datas estão **TACHADAS** (p. 7 e 42, conferido na imagem). Texto vigente: `UB12-10 | Implementação futura | Implementação futura`. **As consultorias estavam certas; o CGIBS não.** | — |
| ~~P2~~ | ~~Tabela oficial `cClassTrib`~~ — **RESOLVIDO**: planilha oficial obtida (`cClassTrib 2026-06-22.xlsx`, 165 códigos; Portal NF-e → Documentos → **Diversos**). Os três batem: **200047** bares e restaurantes (CST 200, `pRedIBS`=`pRedCBS`=**40**), **410019** gorjeta, **410020** intermediação — os três com `indNFCe`=1. ⚠️ A NT está em **v1.51**; quem está em **v1.60** é o **Informe Técnico**, não a NT | — |
| P3 | **`pCBS` de 2027** — a planilha oficial de alíquotas diz literalmente "aguarda legislação" (2026 = 0,009). Fórmula da lei: **alíquota de referência do art. 14 menos 0,1 p.p.** (LC 214, art. 347) | Campo parametrizável **por ano**, jamais constante; revisar após 15/12/2026 |
| P4 | **Taxa de entrega PRÓPRIA** (motoboy da casa) — a lei condiciona a exclusão a "por plataforma digital"; escritórios leem de forma mais ampla. E em qual alíquota seria tributada | Divergência não pacificada |
| P5 | **Fórmula do rateio da gorjeta** (RIBS art. 399, §3º) em comanda mista | Redação ambígua, sem nota oficial |
| P6 | Se a vedação de crédito do art. 276 prevalece sobre o crédito do Simples (LC 123, art. 23, §2º) | Sem manifestação oficial |
| P7 | **Como imprimir IBS/CBS no DANFE** — a NT diz "em estudo" | Aguardar nova versão da NT |
| P8 | **Anexos do Imposto Seletivo** (NCM e `cClassTribIS`) — "tabela a ser publicada" | O grupo IS não é preenchível ainda |
| P9 | **Datas de obrigatoriedade do split payment** — nenhuma norma publicada; os manuais de 28/08/2026 são de habilitação de **PSPs**, não de PDV | Acompanhar `cgibs.gov.br/atos-tecnicos-conjuntos`; **não construir nada agora** |
| P10 | **Tabela de limites por UF** — a NT 2026.002 anunciou, mas a tabela não foi localizada publicada. **O que MUDOU:** a RV **W16-40** já está **em produção desde 15/06/2026** com o texto "ou outro valor definido pela UF", e 7 UFs já têm valor conhecido (§2) | **FEITO em 23/09/2026** (mig 285): parametrizado por UF + por loja, com default = o mais restritivo conhecido. Segue aberto só o rastreio da tabela oficial |
| ~~P11~~ | ~~Faixas de série reservadas para o modelo 65~~ — **RESOLVIDO, e a cautela estava certa**: o nacional revogou, **mas o RN reserva 890-989 para contingência desde 01/03/2020**. ⇒ **nunca usar 890-989**, em UF nenhuma. A faixa também nunca foi "890-899": foram **890-989** e **501-999** | — |
| ~~P12~~ | ~~URLs de QR Code das 27 UFs~~ — **RESOLVIDO**: as 27 levantadas (26 `OFICIAL`), em `assets/endpoints-nfce.json` da skill. ⚠️ **Publicada ≠ no ar**: em **MA, RN e PB** a URL oficial está **morta** — quem imprimir a do ENCAT gera DANFE com link quebrado. **Sondar o host antes de habilitar a UF** | — |
| P13 | **Prazo de validade do CSC** na maioria das UFs | Segue aberto. Indício novo: a tela de **SE** exibe "Data Início/Data Fim". ⚠️ O vocabulário nacional é *revogado* (463) / *não cadastrado* (462) / *hash difere* (464) — "CSC expirado" não aparece em fonte nacional |
| ~~P14~~ | ~~Regras estaduais de AC, AP, MA, PA, PB, PI, RN, RO, RR, SE, TO~~ — **RESOLVIDO**: as **27 UFs** têm ficha completa na skill (`referencias/estados/{UF}.md`), com autorizador, QR, CSC, credenciamento, prazos, contingência e exigências próprias | — |
| ~~P15~~ | ~~`cIdToken` com ou sem zeros~~ — **RESOLVIDO: SEM zeros à esquerda** ("1", não "000001"). Manual do DANFE NFC-e e QR Code **v6.0**, §4.3.1 e §4.3.2, texto idêntico, com exemplo no §4.3.6.1. **O hash usa a mesma forma que vai na URL.** O "000001" é do **QR v1, desativado em 01/10/2018** — é por isso que o manual do RJ se contradizia | — |
| ~~P21~~ | ~~Contingência off-line: o RJ permite?~~ — **RESOLVIDO: PERMITE.** Manual NFC-e da SEFAZ/RJ de **16/07/2026**, pergunta 1.28: *"emissão **offline**, com transmissão do arquivo para a SEFAZ até o **primeiro dia útil subsequente**… A decisão da emissão da NFC-e em contingência é **exclusiva do contribuinte** e não depende de autorização do Fisco."* ⚠️ **Não são 24 h** — o próprio manual registra a troca em 30/01/2017 (o título da pergunta 1.30 ficou velho). **A implementação está liberada** | **RESOLVIDO em 23/09/2026** (mig 286): entrada automática pelo silêncio da SEFAZ, saída pelo status do serviço, fila transmitida dentro do prazo, DANFE com "EMITIDA EM CONTINGENCIA" + 2ª via. Ver §6 |
| ~~P22~~ | ~~Denegação → rejeição 781~~ — **RESOLVIDO 23/09/2026, e a premissa era outra**: as duas formas estão **vigentes** no MOC consolidado (1C17-38 → 781 rejeição · 1C17-40 → 301 denegação), então não se trata de substituir uma pela outra. O defeito real era nosso: a **denegação vinda da autorização** era gravada como `rejeitada`, e o número denegado entraria no relatório de lacunas (ERR-094) | — |
| ~~P23~~ | ~~Grupo `cMsg`/`xMsg` não é lido~~ — **RESOLVIDO 23/09/2026**: lido na autorização e na consulta, gravado no `motivo` e logado. Confirmado no **XSD oficial** (`TProtNFe`), já que o nome "PR13" e o `cStat 120` não aparecem no MOC consolidado on-line | — |
| ~~P24~~ | ~~Limite de identificação por UF não é configuração~~ — **RESOLVIDO 23/09/2026** (mig 285): tabela por UF em `fiscal/destinatario.ts` + `fiscal_config.limite_identificacao` por loja; UF fora da tabela cai no piso mais restritivo conhecido | — |
| P26 | **CNPJ dos intermediadores (iFood, 99Food…)** não está cadastrado (novo) | O número vai dentro de documento fiscal: tem de vir da **nota de serviço que a plataforma emite contra a loja**. Até lá, `CNPJ_INTERMEDIADOR` fica vazio e o pedido de marketplace é **recusado com o motivo**, nunca emitido como venda direta |
| P27 | **Transportador em pedido com logística do marketplace** (novo) | Hoje declaramos a própria loja em toda entrega com `indPres=4`. Quando quem leva é a logística do canal, o transportador correto seria o do canal — depende do P26 |
| P25 | **Benefício de bar e restaurante vence em 31/12/2026** (novo) | Acompanhar CONFAZ e DOE em nov–dez/2026 — vence no país inteiro, **na mesma data da CBS cheia** |
| ~~P20~~ | ~~Cancelamento por substituição~~ — **RESOLVIDO 23/09/2026** (mig 284): evento 110112, re-consulta da nota "inexistente" dentro das 168 h, lista de duplicidades com o prazo restante e cancelamento pela tela. | — |
| ~~P19~~ | ~~Número queimado~~ — **RESOLVIDO 22/09/2026** (migs 282/283): inutilização implementada; reaproveitamento descartado por vedação do MOC (ver §5.1). | — |
| ~~P18~~ | ~~Nota que fica `pendente`~~ — **RESOLVIDO 22/09/2026** (mig 281): consulta pela chave, carência de 2 min para o 217, job nas duas pontas e a venda consultando antes de emitir. | — |
| ~~P17~~ | ~~RJ → SVRS na NFC-e~~ — **RESOLVIDO 22/09/2026**: o "Testar conexão com a SEFAZ" com o certificado real trouxe **107 — Serviço em Operação** da SVRS para `cUF=33`. A SVRS só responde 107 para UF que atende. | — |
| ~~P16~~ | ~~.pfx exportado pelo Windows~~ — **RESOLVIDO 22/09/2026**: o certificado real da loja-piloto, exportado do Windows, foi cadastrado em produção e abriu no `node-forge`. O botão "Testar certificado" (etapa B) prova também a assinatura com ele. | — |

---

## 8. Changelog

| Data | O que mudou |
|---|---|
| 23/09/2026 | **DANFE do totem (K6).** O texto do DANFE saiu de dentro de `imprimirDanfe` para `fiscal/danfe-texto.ts` e passou a ser UM só: a impressora do caixa e o totem GoGeM imprimem o mesmo documento. `resumoNfce` ganhou o campo `danfe` (o texto pronto, com o marcador `@QR:`), e `emitir`/`emitirSeAtivo` ganharam `opts.imprimirNaLoja` — a venda do totem pede `false`, senão a mesma nota sairia duas vezes (uma no totem, outra no balcão). O texto ganhou a mensagem **"EMITIDA EM CONTINGÊNCIA"** quando o status é `contingencia`, exigida pelo Manual do DANFE NFC-e; no totem, a contingência imprime também a **segunda via "Via do Estabelecimento"**. Do lado do totem: QR nativo no ESC/POS (`GS ( k`, modelo 2, módulo 6 = ~43 mm, correção M — a norma pede ≥ 25 mm), os **mesmos bytes** do `edge/escpos.mjs`. Nota emitida cujo DANFE não sai vai para a fila de reimpressão e a tela avisa o cliente a retirar no balcão; o **cancelamento + estorno** desse caso é o passo seguinte (F4), ainda não implementado. |
| 23/09/2026 | **A 2ª via de papel da contingência virou opção, desligada por padrão** (mig 287). Restaurante entrega só a via do cliente; a guarda passa a ser o XML, que o MOC aceita expressamente (Anexo IV, §4) e que já fica arquivado e reimprimível. Quem precisar do papel liga na configuração fiscal. ⚠️ A guarda eletrônica exige termo lavrado no livro modelo 6 — isso é da loja, não do sistema. |
| 23/09/2026 | **Contingência off-line COMPLETA** (mig 286). Quando a SEFAZ fica muda, o ponto de emissão entra em contingência sozinho, a venda sai com `tpEmis=9` num número NOVO (o da nota pendente não se reaproveita), nenhuma venda seguinte tenta a SEFAZ (era a espera que travava o caixa), e um job de 5 minutos sai da contingência assim que o status do serviço volta `107` e transmite a fila com o XML original. **Rejeição na transmissão não tira a nota da fila** — número de contingência não pode ser inutilizado. DANFE com "EMITIDA EM CONTINGENCIA" e 2ª via; a tela de notas mostra o prazo de cada uma. **P21 resolvido.** |
| 23/09/2026 | **Contingência off-line, parte 1** (sem migration): a NFC-e com `tpEmis=9`, `dhCont` e `xJust`, e o **QR Code v3 off-line assinado** (oito parâmetros; RSA-SHA1 dos parâmetros 1 a 7 com o A1 da loja). Sem efeito na emissão ainda — é a base das partes 2 e 3. Junto, uma trava que faltava: a chave de acesso e o `ide` têm de concordar no `tpEmis`, que é o 35º dígito da chave. |
| 23/09/2026 | **Denegação separada da rejeição e o aviso da SEFAZ lido** (sem migration). A denegação vinda da autorização virava `rejeitada`, e o número denegado — que a SEFAZ **já tem na base** — entraria no relatório de lacunas para ser inutilizado (ERR-094). Agora `110/301/302` gravam `denegada`, com o protocolo do registro. Junto: o grupo **`cMsg`/`xMsg`** (aviso da SEFAZ ao emissor, confirmado no XSD oficial) passou a ser lido na autorização e na consulta, entrar no `motivo` e sair no log. **P22 e P23 resolvidos** — e a premissa do P22 estava errada: 781 (rejeição) e 301 (denegação) estão **as duas vigentes**, cada UF com a sua. |
| 23/09/2026 | **Destinatário, entrega a domicílio e intermediador** (mig 285). A nota de delivery passa a sair como `indPres=4` com `dest`/`enderDest`/`transporta` quando há CPF e endereço, e como presencial com a taxa em `vOutro` quando não há — o que **corrige a rejeição 753**, que toda nota de delivery com taxa da loja receberia. `indIntermed` passou a sair **sempre** (434). Limite de identificação parametrizado por UF e por loja (**P24 resolvido**, P10 encaminhado). CPF opcional no cardápio do Regem, lido do payload nos canais externos e conferido pelo dígito verificador antes de entrar no XML. Abertas **P26** (CNPJ dos intermediadores) e **P27** (transportador na logística do canal). |
| 23/09/2026 | **Revisão a partir da skill global `cupom-fiscal`** (27 UFs em fonte oficial). **Resolvidas P1, P2, P11, P12, P14, P15 e P21**; abertas **P22-P25**. Correções no corpo: escrituração (**inutilizada e denegada NÃO entram** na EFD — o código 05 caiu em jan/2023); **limites são parametrizáveis por UF por norma nacional** e nenhuma UF usa R$ 10.000; **a denegação acabou na NFC-e** (rejeição 781, que não consome número) e o nosso `consulta-protocolo.ts` está desatualizado; **XSD vigente é o PL_010f_v1.04**, não o PL_009_V4; **a rejeição 1115 perdeu a data** (v1.51 riscou); `cStat 120` entra em produção em **05/10/2026** e exige ler o grupo **PR13**; **série 890-989 é reservada no RN**; **PA também exige software credenciado**, não só SC; §3 ganhou pagamento vinculado (5 UFs), documento impresso extra (CE/RN) e FCP (4 decisões por UF). |
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
