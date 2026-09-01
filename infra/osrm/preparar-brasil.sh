#!/usr/bin/env bash
# OSRM — preprocessa o mapa do BRASIL (perfil car, algoritmo MLD) para o rastreio/rota do Regem.
# Rode UMA vez na VPS (e no refresh mensal). Cria um swap TEMPORÁRIO porque o osrm-extract do
# Brasil estoura 8 GB de RAM; o swap é usado só aqui e pode ser removido no fim. Requer docker.
#
#   uso:  sudo bash preparar-brasil.sh [DATA_DIR]     # default: /opt/osrm-data
#
set -euo pipefail
DATA_DIR="${1:-/opt/osrm-data}"
IMG="ghcr.io/project-osrm/osrm-backend:latest"
PBF="brazil-latest.osm.pbf"
URL="https://download.geofabrik.de/south-america/brazil-latest.osm.pbf"

echo "== [1/5] swap de 16 GB (só p/ o extract não estourar a RAM de 8 GB) =="
if ! swapon --show 2>/dev/null | grep -q /swapfile-osrm; then
  fallocate -l 16G /swapfile-osrm 2>/dev/null || dd if=/dev/zero of=/swapfile-osrm bs=1M count=16384
  chmod 600 /swapfile-osrm && mkswap /swapfile-osrm && swapon /swapfile-osrm
  echo "   swap ativado."
else
  echo "   swap já ativo."
fi

MIRROR="https://download.openstreetmap.fr/extracts/south-america/brazil.osm.pbf"
mkdir -p "$DATA_DIR" && cd "$DATA_DIR"
echo "== [2/5] baixando o mapa do Brasil (~1.6 GB) — pode demorar =="
# Só (re)baixa se ainda não temos um arquivo GRANDE (>100 MB); um 502 antigo deixa um lixo
# de KB que não pode virar "já baixado". Retry automático no 502 do Geofabrik; se falhar de
# vez, cai no mirror do OSM-France.
if [ ! -f "$PBF" ] || [ "$(stat -c%s "$PBF" 2>/dev/null || echo 0)" -lt 104857600 ]; then
  rm -f "$PBF"
  curl -fL --retry 8 --retry-delay 15 --retry-all-errors -C - -o "$PBF" "$URL" \
    || curl -fL --retry 8 --retry-delay 15 --retry-all-errors -C - -o "$PBF" "$MIRROR"
fi
test "$(stat -c%s "$PBF" 2>/dev/null || echo 0)" -ge 104857600 || { echo "ERRO: download do mapa falhou (arquivo pequeno demais)."; exit 1; }

echo "== [3/5] osrm-extract (perfil car) — passo mais pesado, usa o swap =="
docker run --rm -t -v "$DATA_DIR:/data" "$IMG" osrm-extract -p /opt/car.lua "/data/$PBF"
echo "== [4/5] osrm-partition =="
docker run --rm -t -v "$DATA_DIR:/data" "$IMG" osrm-partition /data/brazil-latest.osrm
echo "== [5/5] osrm-customize =="
docker run --rm -t -v "$DATA_DIR:/data" "$IMG" osrm-customize /data/brazil-latest.osrm

echo
echo "PRONTO — arquivos .osrm em $DATA_DIR."
echo "Agora suba o serviço osrm-routed (ver README.md) e, depois que ele responder, remova o swap:"
echo "   swapoff /swapfile-osrm && rm -f /swapfile-osrm"
