#!/usr/bin/env bash
# ghost-handoff-guard.sh — repo-root 핸드오프 유령 경로 커밋 차단 belt
# T-20260720-foot-REPO-GHOST-SIGNALS-BELT-INSTALL (parent §3 code-gate 이행, supervisor cogate)
#
# 배경: foot repo 는 repo-root signals.md·retro/ 유령본을 상속했고, main 유령본은
#       T-20260720-foot-REPO-GHOST-SIGNALS-SWEEP(done)에서 삭제 완료.
#       그러나 belt(본 guard) 미설치 → 활성 브랜치가 상속한 유령 signals.md 가 main 병합 시
#       modify/delete 충돌·부주의 해소로 resurrection 가능 → 재발방지 code-gate 로 봉인.
# 원칙: 핸드오프(signals/retro)는 claude-sync SSOT(~/claude-sync/memory/_handoff/) 전용.
#       레포 안 signals.md / retro/ = 포크 상속 유령 — 쓰기 자체가 hazard.
# 원저: obliv-scalp2-crm commit 9a6e219e
#       (T-20260719-scalp-REPO-LOCAL-SIGNALS-RETRO-GHOST-HYGIENE gate2 belt).
# 참고: PHI-HOOK signals sentinel allowlist 와 별개 규칙
#       (그쪽=SSOT sentinel allowlist, 본건=레포-로컬 유령본 커밋 차단).
#
# 우회(비권장, 사유 커밋메시지 명기): GHOST_HANDOFF_BYPASS=1 git commit ...
set -euo pipefail

viol="$(git diff --cached --name-only | grep -E '^(signals\.md$|retro/)' || true)"

if [ -n "$viol" ]; then
  echo "🚫 [ghost-handoff-guard] repo-root 핸드오프 유령 경로 커밋 차단:" >&2
  echo "$viol" | sed 's/^/   - /' >&2
  echo "   핸드오프(signals/retro)는 claude-sync SSOT(~/claude-sync/memory/_handoff/) 전용입니다." >&2
  echo "   근거: T-20260720-foot-REPO-GHOST-SIGNALS-BELT-INSTALL (DA GO r8wl / supervisor cogate / 원저 scalp2 9a6e219e)" >&2
  echo "   우회(비권장): GHOST_HANDOFF_BYPASS=1 git commit ..." >&2
  exit 1
fi

exit 0
