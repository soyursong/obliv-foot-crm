#!/usr/bin/env bash
# secret-scan.sh — 평문 비번/키 commit 차단 (T-20260629-ops-TESTCRED-PLAINTEXT-LIVECRED Stage 3)
#
# 사용:
#   scripts/secret-scan.sh            # 스테이징된 변경분 스캔 (pre-commit 용)
#   scripts/secret-scan.sh --all      # 전체 git-tracked 파일 스캔
#
# gitleaks 가 설치돼 있으면 .gitleaks.toml 룰로 스캔하고,
# 없으면 핵심 안티패턴(평문 비번 하드코딩)만 잡는 grep fallback 으로 동작한다.
# 타 CRM 이식: 이 스크립트 + .gitleaks.toml + .github/workflows/secret-scan.yml + .githooks/pre-commit 복사.
set -euo pipefail

MODE="${1:-staged}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }

if command -v gitleaks >/dev/null 2>&1; then
  if [ "$MODE" = "--all" ]; then
    gitleaks detect --config .gitleaks.toml --redact --no-banner
  else
    gitleaks protect --staged --config .gitleaks.toml --redact --no-banner
  fi
  grn "[secret-scan] gitleaks 통과 — 평문 비밀/키 없음"
  exit 0
fi

# ---- gitleaks 미설치 fallback (핵심 룰만) ----
echo "[secret-scan] gitleaks 미설치 → grep fallback 사용 (설치 권장: brew install gitleaks)"

if [ "$MODE" = "--all" ]; then
  FILES=$(git ls-files)
else
  FILES=$(git diff --cached --name-only --diff-filter=ACM)
fi

[ -z "$FILES" ] && { grn "[secret-scan] 스캔 대상 없음"; exit 0; }

# 평문 비번 하드코딩 탐지 (2종):
#  PAT          = 직접 대입       const PW = '리터럴'
#  PAT_FALLBACK = env 폴백 대입    const PW = process.env.X || '리터럴'  / ?? '리터럴'
# ★ env 폴백에 평문 비번을 두는 것도 leak 이므로 잡는다. throw-IIFE( || (() => {...})() )는 ||뒤가 '(' 라 미탐.
PAT='(pass(word)?|pwd|[^a-z]pw[^a-z]|login_pass)[[:space:]]*[:=][[:space:]]*['"'"'"][^'"'"'"]{3,}['"'"'"]'
# ★ keyword→fallback 리터럴 거리를 .{0,60} 로 바운드 (.gitleaks.toml 룰과 동일). 무한 .* 면
#   logLine("PASS", {... || "(gate-only)" }) 같은 무관 라인을 가로질러 매칭하는 오탐 발생.
PAT_FALLBACK='(pass(word)?|pwd|[^a-z]pw[^a-z]|login_pass).{0,60}(\|\||\?\?)[[:space:]]*['"'"'"][^'"'"'"]{3,}['"'"'"]'
# ★ DB 연결 URI 에 임베드된 평문 비번 (postgres://user:<PASS>@host) — keyword 인접 'password=' 없어
#   PAT/PAT_FALLBACK 가 못 잡던 형태. T-20260629-foot-TESTCRED-FIXTURE-CLEAN Stage C 보강.
#   비번 segment 에 $ { } (템플릿 변수) 배제 → env 주입 URL(`...:${pw}@`)은 미탐(오탐 방지).
PAT_PGURL='postgres(ql)?://[^[:space:]:'"'"'"@/]+:[^[:space:]'"'"'"@/$\{\}]{3,}@'
# 주의: process.env 는 ALLOW 에서 제외 — 폴백 평문을 가려선 안 됨. (순수 env 라인은 = 뒤가 quote 가 아니라 미탐)
# 리터럴 = 본 스크립트/문서의 placeholder 토큰("literal" 한글) — placeholder/example 류와 동급 화이트리스트.
# \[AC[0-9-] = foot e2e spec 의 수용기준 로그 마커 (console.log("[AC-3] ... PASS: ...")). status 라벨 PASS:/FAIL: 가
#   PAT 의 keyword 로 오탐되는 것을 차단. 자격증명 대입 라인에는 [AC-n] 마커가 없어 충돌 없음.
ALLOW='import\.meta\.env|Deno\.env|type=["'"'"']password|["'"'"']password["'"'"'][[:space:]]*[:,)]|\.fill\(|\.{3,}|<[^>]+>|\*{3,}|placeholder|example|리터럴|REPLACE|CHANGE|\[AC[0-9-]'

HITS=""
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in node_modules/*|dist/*|*.lock|package-lock.json|*i18n.*|*/i18n/*|*/locale/*|*/locales/*) continue;; esac
  m=$(grep -inE "$PAT|$PAT_FALLBACK|$PAT_PGURL" "$f" 2>/dev/null | grep -ivE "$ALLOW" || true)
  [ -n "$m" ] && HITS="${HITS}\n${f}:\n${m}\n"
done

if [ -n "$HITS" ]; then
  red "[secret-scan] 평문 비밀번호 하드코딩 의심 — commit 차단:"
  printf '%b\n' "$HITS"
  red "→ process.env 로 주입하세요 (e2e/config.ts 패턴). 오탐이면 .gitleaks.toml allowlist 보강."
  exit 1
fi
grn "[secret-scan] fallback 통과 — 평문 비번 하드코딩 없음"
