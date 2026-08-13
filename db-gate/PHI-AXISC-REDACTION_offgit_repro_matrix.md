# PHI axis-C (T-20260813-ops-PHI-AXISC) — off-git dump 재생산 매트릭스

Phase A working-tree redaction. 아래 dump-형 산출물 5건은 `git rm --cached` + `.gitignore` 로 off-git 처리(평문 식별자 제거).
로컬 백업은 git 밖(`~/phi-axisc-backup/foot/`). 필요 시 아래 생성 스크립트로 재생산 가능(dev DB rxlomoozakkjesdqjtvd, service_role).

| off-git 산출물 | 재생산 스크립트 |
|---|---|
| `db-gate/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_probe_evidence.json` | `node scripts/T-20260728-foot-PAYMENT-WAITING-STUCK-PROMOTION-CLASS_probe.mjs` |
| `scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_pathC_charge.out.json` | `node scripts/T-20260629-foot-DUMMY-CHECKIN-RESV-LINK_pathC_charge.mjs` (dry-run, outPath 자동 기록) |
| `scripts/visittype_backfill_capture_2026-06-02T1057.json` | `node scripts/apply_20260602_visittype_returning_backfill.mjs` (captureFile 자동 타임스탬프 기록) |
| `evidence/T-20260810-foot-ARCHE-BABSENT34_roster.json` | `node scripts/T-20260810-foot-ARCHE-BABSENT34-VOID-CONFIRMGATE_roster_probe.mjs` |
| `scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_apply_resolve.out.json` | `node scripts/T-20260701-foot-STAFF-ROSTER-DEDUP_apply_resolve.mjs` |

주: git-history 미접촉(working-tree only). history 내 blob 정리는 별건 Phase B.
