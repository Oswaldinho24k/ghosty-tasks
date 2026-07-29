#!/usr/bin/env bash
# Deploy de Ghosty Tasks a su caja del host OVH.
#
# Build local (.output de Nitro) → push a la caja por la API del sandbox-host →
# restart del unit. La caja DUERME por inactividad: el `exec` la despierta solo.
#
# Es el mismo cuerpo que ejecutará el job de CI cuando el repo tenga runner
# (hoy falta permiso de admin en GitHub para registrarlo — ver docs/DEPLOY.md).
#
# Uso:  ./scripts/deploy_tasks.sh
set -euo pipefail

HOST="${HOST:-54.38.94.14}"
KEY="${KEY:-$HOME/.ssh/id_rsa_ovh}"
APP="${APP:-$(cd "$(dirname "$0")/.." && pwd)}"
SID="${SID:-sb_c4cec06e-32ac-4d93-b72e-0f21e853ad38}"
SSH="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
SCP="scp -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

echo "▸ [1/3] build local (.output)"
( cd "$APP" && NITRO_PRESET=node-server npx vite build >/dev/null )
# COPYFILE_DISABLE=1 + --no-xattrs: sin esto macOS mete AppleDouble (`._*`) en el
# .tgz y al extraer en Linux ensucian el .output.
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/gt-build.tgz -C "$APP" .output

echo "▸ [2/3] scp build → host"
$SCP /tmp/gt-build.tgz "root@$HOST:/tmp/gt-build.tgz"

echo "▸ [3/3] push a la caja + restart"
$SSH "root@$HOST" "SID=$SID bash -s" <<'EOF'
set -euo pipefail
TOK=$(grep -oP "^SANDBOX_HOST_TOKEN=\K.*" /etc/sandbox-host/.env); API=http://127.0.0.1:8080
base64 -w0 /tmp/gt-build.tgz > /tmp/gt-b64.txt
jq -nc --arg p /tmp/gt-build.tgz --rawfile c /tmp/gt-b64.txt '{path:$p,content:$c,encoding:"base64"}' > /tmp/gt-fw.json
echo -n "  put="; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/v1/sandbox/$SID/files/write" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" --data-binary @/tmp/gt-fw.json
rm -f /tmp/gt-fw.json /tmp/gt-b64.txt
# El .env de la caja NO se toca desde aquí: los secretos viven solo ahí.
CMD='cd /app/ghosty-tasks && rm -rf .output && tar xzf /tmp/gt-build.tgz && systemctl restart ghosty-tasks && sleep 4 && systemctl is-active ghosty-tasks && curl -s -o /dev/null -w "local=%{http_code}\n" http://127.0.0.1:3001/login'
echo -n "  unit="; curl -s -X POST "$API/v1/sandbox/$SID/exec" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d "$(jq -nc --arg c "$CMD" '{command:$c,timeoutSeconds:120}')" | jq -r '.stdout'
EOF

echo "▸ verifica público"
curl -s -o /dev/null -w "  https=%{http_code}\n" --max-time 25 https://tasks.ghosty.studio/login || true
echo "✓ deploy listo."

# (el CI verifica que este script y el workflow no se desincronicen)
