---
id: T-20260614-foot-RXSET-BUNDLE-MERGE
domain: foot
priority: P1
status: db-gate-pending
deploy-ready: false
build-ok: true
db-change: true
regression-risk: low
e2e-spec: tests/e2e/T-20260614-foot-RXSET-BUNDLE-MERGE.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-14
assignee: dev-foot
reporter: 문지은 대표원장 (macro-A 현장확정)
db-gate-handoff: db-gate/T-20260614-foot-RXSET-BUNDLE-MERGE_dbgate.md
---

# T-20260614-foot-RXSET-BUNDLE-MERGE — 묶음처방 단독약 → 처방세트 '약' 폴더 그룹핑 (옵션A)

현장확정(문지은 대표원장, macro-A): 묶음처방(prescription_sets) 탭 **유지**, 단독약(items 1종) 세트만
처방세트 **'약' 폴더**로 그룹핑. 다종 묶음세트는 대표원장이 직접 생성. round4 결정 정합 → **CEO 게이트 불요**.

## AC-1 (선행, 착수 전 필수) — 완료
prescription_sets 단독약 개수 + folder 분포 조회 → FOLLOWUP 보고 완료(MSG-20260614-203707-6yzv).
- 결과: total=19, 단독약=19, 다종=0, folder 전부 NULL, 옵션A UPDATE 대상=19, FK참조 1건, NAMEDESC 미적용.
- 감사 스크립트: `scripts/T-20260614-foot-RXSET-BUNDLE-MERGE_ac1_audit.mjs` (READ-ONLY).

## AC-2 — 옵션A (folder='약' 백필) ✅ 패키지 작성, apply는 supervisor 데이터게이트 후
- 행 보존·posology 무손실·set id 불변·가역. folder 컬럼만 UPDATE.
- 마이그: `supabase/migrations/20260614120000_rxset_bundle_drugfolder.sql` (백업+UPDATE+검증)
- 롤백: `supabase/migrations/20260614120000_rxset_bundle_drugfolder.rollback.sql`
- dry-run: `supabase/ops/rxset_bundle_dryrun_20260614.sql` (will_update 건수 대조)
- 멱등(`folder IS DISTINCT FROM '약'`)·다종 무접촉(`jsonb_array_length(items)=1`).
- 옵션B(해체→prescription_folders 이관)는 posology 손실+CASCADE 삭제 위험 → AC-1상 옵션A 100% 적합이라 불요.

## AC-3 — 묶음처방 탭 삭제 금지 ✅
다종 0건이라 탭은 빈 상태로 잔존. 탭/컴포넌트 무삭제(코드 미변경).

## AC-4 — quick_rx_buttons 참조 무결성 ✅
옵션A는 set id 불변 → `quick_rx_buttons.prescription_set_id` FK(ON DELETE CASCADE) 보존. 재배선 불요.

## ⚠️ NAMEDESC-MODEL 순서 조율
같은 prescription_sets 테이블이나 **컬럼 비중첩**(NAMEDESC=items, 본건=folder) → 데이터 충돌 없음.
본건 WHERE는 items 내용 무관 → 적용 전/후 안전. 티켓 권고대로 NAMEDESC 게이트 통과 후 apply 권장.

## E2E
`tests/e2e/T-20260614-foot-RXSET-BUNDLE-MERGE.spec.ts` (9/9 통과): 마이그 불변식 + 약폴더 그룹핑 표시 + QuickRxBar/처방선택 핵심경로 회귀.

## 다음
supervisor 데이터게이트(dry-run count=19 대조) GO → dev-foot 마이그 직접 apply → 검증 → deploy-ready 승격.
