#!/usr/bin/env bash
# ghost-handoff-guard.sh — repo-root 핸드오프 유령 경로 유입 차단 guard (공유 검출 로직)
# T-20260720-foot-REPO-GHOST-SIGNALS-BELT-INSTALL   (supervisor cogate, DA GO r8wl)  — staged 모드(belt/pre-commit)
# T-20260720-foot-REPO-GHOST-PREPUSH-GUARD-PORT     (supervisor cogate, DA GO)        — range 모드(pre-push) 추가
# 원저: obliv-scalp2-crm 9a6e219e (T-20260719-scalp-REPO-LOCAL-SIGNALS-RETRO-GHOST-HYGIENE gate2)
#       reference impl: obliv-body-crm 4f8826c6 (T-20260720-body-REPO-GHOST-PREPUSH-GUARD-HARDEN)
#
# 배경: foot 는 하드포크 계보 origin 으로 repo-root signals.md·retro/ 유령본을 상속했고,
#       origin/main 유령본은 T-20260720-foot-REPO-GHOST-SIGNALS-SWEEP(done, b6975397)에서 삭제 완료.
#       그러나 활성 브랜치가 상속한 유령 signals.md 가 main 병합·push 시 resurrection 가능 →
#       staged belt(pre-commit)가 못 잡는 ff-merge·무충돌 auto-merge tail-gap 을 pre-push range 로 봉인.
# 원칙: 핸드오프(signals/retro)는 claude-sync SSOT(~/claude-sync/memory/_handoff/) 전용.
#       레포 안 signals.md / retro/ = 포크 상속 유령 — 쓰기 자체가 hazard.
#       dev-foot 핸드오프는 mq send + 티켓 frontmatter(SSOT)로만.
# 참고: PHI-HOOK signals sentinel allowlist 와 별개 규칙
#       (그쪽=SSOT sentinel allowlist, 본건=레포-로컬 유령본 커밋/push 차단).
#
# 사용:
#   ghost-handoff-guard.sh                      # staged 모드(기본) — pre-commit belt. git diff --cached 스캔.
#   ghost-handoff-guard.sh staged               # 위와 동일
#   ghost-handoff-guard.sh range <base> <tip>   # pre-push 모드 — remote_sha..local_sha 커밋 유입분 스캔.
#                                               #   base=0{40}(신규 브랜치)면 tip 트리의 유령 실재만 검사(오탐 최소화).
#
# 우회(비권장, 사유 명기): GHOST_HANDOFF_BYPASS=1 (belt/pre-push hook 래퍼에서 처리)
set -euo pipefail

Z40="0000000000000000000000000000000000000000"

# --- 공유 검출: 파일 목록(stdin) 중 repo-root signals.md / retro/ 매칭만 출력 ---
_ghost_match() {
  grep -E '^(signals\.md$|retro/)' || true
}

# --- 공유 리포트: 위반 목록 인자로 받아 안내 후 exit 1 ---
_ghost_report_and_die() {
  local viol="$1"
  echo "🚫 [ghost-handoff-guard] repo-root 핸드오프 유령 경로 유입 차단:" >&2
  echo "$viol" | sed 's/^/   - /' >&2
  echo "   핸드오프(signals/retro)는 claude-sync SSOT(~/claude-sync/memory/_handoff/) 전용입니다." >&2
  echo "   dev-foot 는 mq send + 티켓 frontmatter 로만 핸드오프하세요." >&2
  echo "   근거: T-20260720-foot-REPO-GHOST-SIGNALS-BELT-INSTALL / -PREPUSH-GUARD-PORT (DA GO / supervisor cogate / 원저 scalp2 9a6e219e)" >&2
  echo "   우회(비권장): GHOST_HANDOFF_BYPASS=1 (사유 명기)" >&2
  exit 1
}

MODE="${1:-staged}"

case "$MODE" in
  staged)
    # pre-commit belt: 스테이징된 유령 경로 차단
    viol="$(git diff --cached --name-only | _ghost_match)"
    ;;
  range)
    # pre-push: push 대상 ref-range 의 유령 경로 유입/부활 차단
    base="${2:?range 모드는 <base> <tip> 인자가 필요합니다}"
    tip="${3:?range 모드는 <base> <tip> 인자가 필요합니다}"
    if [ "$base" = "$Z40" ]; then
      # 신규 remote 브랜치 push: 전체 히스토리가 아니라 tip 트리의 유령 실재만 검사(오탐 최소화)
      viol="$(git ls-tree -r --name-only "$tip" | _ghost_match)"
    else
      # 기존 브랜치 갱신: remote_sha..local_sha 로 유입되는 변경분만 검사
      viol="$(git diff --name-only "$base" "$tip" | _ghost_match)"
    fi
    ;;
  *)
    echo "ghost-handoff-guard.sh: 알 수 없는 모드 '$MODE' (staged|range)" >&2
    exit 2
    ;;
esac

if [ -n "$viol" ]; then
  _ghost_report_and_die "$viol"
fi

exit 0
