# OSRM self-hosted — rota real + ETA + roteirização (Regem delivery)

Serviço de roteirização **self-hosted** (dado em casa, sem custo por chamada) que alimenta:
rota no rastreio do cliente (`/r/[token]`), ETA real e roteirização por prazo. Perfil **car**,
algoritmo **MLD** (leve em RAM). **É infra da DISTRIBUIÇÃO** — o usuário nunca toca nisso.

VPS de referência: 8 GB RAM / 100 GB disco → Brasil inteiro cabe (runtime ~3-5 GB; o
preprocessing usa swap temporário).

## Passo a passo (na VPS, via SSH ou terminal do EasyPanel)

**1) Preprocessar o mapa (uma vez + refresh mensal).** Copie `preparar-brasil.sh` pra VPS e rode:
```bash
sudo bash preparar-brasil.sh /opt/osrm-data
```
Baixa o mapa do Brasil, cria 16 GB de swap e roda extract→partition→customize. Demora
(~30-60 min no 1º). Gera `/opt/osrm-data/brazil-latest.osrm*`.

**2) Subir o serviço osrm-routed** (long-running, só runtime — leve):
```bash
docker run -d --name regem-osrm --restart unless-stopped \
  --memory=6g \
  -v /opt/osrm-data:/data \
  -p 127.0.0.1:5000:5000 \
  ghcr.io/project-osrm/osrm-backend:latest \
  osrm-routed --algorithm mld --max-table-size 3000 /data/brazil-latest.osrm
```
> No **EasyPanel**: crie um App do tipo "Docker Image" (`ghcr.io/project-osrm/osrm-backend:latest`),
> comando `osrm-routed --algorithm mld --max-table-size 3000 /data/brazil-latest.osrm`, volume
> `/opt/osrm-data → /data`, porta interna `5000`. Assim o `regem-api` o alcança pelo nome do
> serviço (ex.: `http://regem-osrm:5000`) sem expor à internet.

**3) Remover o swap** (o runtime não precisa):
```bash
swapoff /swapfile-osrm && rm -f /swapfile-osrm
```

**4) Apontar o `regem-api` pro OSRM.** No EasyPanel → serviço `regem-api` → aba Environment,
adicione:
```
OSRM_URL=http://regem-osrm:5000
```
(use o host interno do serviço OSRM no EasyPanel; se subiu via `docker run` na mesma rede,
`http://127.0.0.1:5000`). Salve → Deploy do `regem-api`.

## Validar
```bash
# São Paulo → Rio (deve responder com routes[].geometry e duration em segundos):
curl "http://127.0.0.1:5000/route/v1/driving/-46.633,-23.55;-43.20,-22.90?overview=full&geometries=polyline6"
```
Se vier `{"code":"Ok", ...}`, o OSRM está no ar.

## Refresh mensal do mapa
Rode de novo o passo 1 (re-baixa + reprocessa) e reinicie o `regem-osrm`. Agende via cron/EasyPanel.

## Contrato usado pelo backend (Fases 1-3)
- `GET /route/v1/driving/{lng},{lat};{lng},{lat}?overview=full&geometries=polyline6` → geometria + `duration`(s)/`distance`(m). (rota no rastreio + ETA da perna)
- `GET /table/v1/driving/{coords}?annotations=duration` → matriz de tempos entre a posição do entregador e as N paradas. (roteirização por prazo)

Env do backend: `OSRM_URL` (default de fallback pode ser vazio → o backend cai no cálculo por
reta, para não quebrar se o OSRM estiver fora).
