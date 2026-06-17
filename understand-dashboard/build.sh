#!/usr/bin/env bash
set -euo pipefail

REPO=/Users/sanggyoon/Documents/KakaoCloud_Project
DIST="$REPO/understand-dashboard/dist"

# 플러그인 dashboard 디렉터리 자동 탐색 (버전 디렉터리 변동 대응 — 최신 버전 사용)
PLUGIN_DASH=$(ls -d "$HOME"/.claude/plugins/cache/understand-anything/understand-anything/*/packages/dashboard 2>/dev/null | sort -V | tail -1)
if [ -z "${PLUGIN_DASH:-}" ] || [ ! -d "$PLUGIN_DASH" ]; then
  echo "ERROR: understand-anything dashboard package를 찾을 수 없습니다." >&2
  exit 1
fi
PLUGIN_ROOT="$PLUGIN_DASH/../.."

# core 의존성 빌드 보장 (대시보드가 @understand-anything/core에 의존).
# 이미 빌드돼 있으면 스킵. 없을 때만 빌드하되 deps-status 사전체크를 끈다
# (ERR_PNPM_IGNORED_BUILDS: tree-sitter/esbuild postinstall 경고가 install을 exit 1로 만들기 때문).
if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
  ( cd "$PLUGIN_ROOT" && pnpm install --frozen-lockfile ) >/dev/null 2>&1 || true
  ( cd "$PLUGIN_ROOT" && pnpm --config.verify-deps-before-run=false --filter @understand-anything/core build )
fi

# demo 정적 빌드: base=/ override, 그래프 URL을 루트 경로로 주입, 출력은 레포 dist로
( cd "$PLUGIN_DASH" \
  && VITE_GRAPH_URL=/knowledge-graph.json \
     VITE_META_URL=/meta.json \
     VITE_CONFIG_URL=/config.json \
     npx vite build --config vite.config.demo.ts --base=/ \
       --outDir "$DIST" --emptyOutDir )

# 그래프 스냅샷을 dist 루트에 복사 (SPA가 같은 오리진에서 fetch)
cp "$REPO/.understand-anything/knowledge-graph.json" "$DIST/"
cp "$REPO/.understand-anything/meta.json" "$DIST/"
cp "$REPO/.understand-anything/config.json" "$DIST/"

echo "Built → $DIST"
