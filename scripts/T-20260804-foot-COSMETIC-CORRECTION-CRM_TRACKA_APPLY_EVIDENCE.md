# Track A 재귀속 APPLY — supervisor dry-run 동봉 evidence

> 티켓: T-20260804-foot-COSMETIC-CORRECTION-CRM · artifact-class: **db_only** (순수 seller_staff_id UPDATE, UI 무변경)
> 착지 근거: 현장 confirm 2게이트 동시 해소 (MSG-20260805-080921-4e35 / responder ywdd / 김주연 총괄 U0ATDB587PV, C0ATE5P6JTH thread 1785492540.190029)
> 작성: dev-foot, 2026-08-05. branch chore/T-20260804-foot-COSMETIC-CORRECTION-CRM
> 스크립트: `scripts/T-20260804-foot-COSMETIC-CORRECTION-CRM_05_trackA_reattr_apply.mjs`

## 게이트 상태 (Track A)
- 해소① **박민지 per-row comp-gate = 불필요 확정** — 현장 B선택("담당치료사별 화장품 매출 표=참고용, 정산 기준 별도") → seller 재귀속이 실 인센티브/정산에 무영향. human_pending 앵커 CLEARED.
- 잔여(execution gate) = **supervisor dry-run 검토 → apply.** (planner 보류 아님)

## 재귀속 2건 (정확히 2 PK, blanket UPDATE 금지)
| # | 고객 | line PK | 현재 seller | → target | 금액 | 근거 |
|---|---|---|---|---|---|---|
| #2a | 김현수 F-4789 | 76199926… | **NULL**(최다혜 therapist 귀속) | 김규리 3a0c6774 | 15,000 | 총괄 명시지시 소급귀속(7/23 seller NULL=7/25이전) |
| #5 | 김영웅 F-4959 | 3a8ed9f3… | **최민지 03642b85** | 김규리 3a0c6774 | 15,000 | 7/25 seller 직접기록, 단순 정정 |

target seller = 김규리 **3a0c6774**(therapist, active) — d26717cb(admin, 7/20생성·판매0) 아님. disambiguation 완료.

## No-Persistence dry-run 결과 (2026-08-05, prod write 0)
- **freeze 지문 재검증 PASS** — 실측 2행, `#2a seller=NULL` / `#5 seller=03642b85`(최민지) = STEP0/1 baseline 과 exact match (drift 0).
- **dry-run `rows_affected_total=2`** (DO..UPDATE..GET DIAGNOSTICS..RAISE SENTINEL_ROLLBACK). 두 라인 모두 정확히 1행씩 매칭.
- **post-probe 무영속 확인** — seller 값 원값 그대로(#2a NULL / #5 최민지). 영속 0.
- **원장 무접점(zero-sum) baseline** — 재귀속 대상 check_in 의 `payments`(n=2, amt=41,200) / `service_charges`(n=1, amt=18,840). seller_staff_id 는 원장 키가 아님 → apply 후에도 **금액 완전 불변**(zero-sum 증명, apply 경로에서 재대조).

## ★ POSTCHECK 기준 — 중간 기대값 (367,000/19건 대조 금지)
Track A 단독 apply = **부분정정**(재귀속 zero-sum, 총합·건수 불변).
- 자동집계 **총합 = 711,000 / 22건 UNCHANGED** ← PASS 기준.
- seller 귀속 델타: **김규리 +30,000 / 최다혜 −15,000 / 최민지 −15,000.**
- ⚠ **367,000/19건(5건 전량 END-state)과 대조 시 거짓 FAIL** — planner 판정① 경고 formalize. 근거 문서 `_handoff/…_trackA-intermediate-expected.md`.

## 롤백 (대칭)
`scripts/T-20260804-foot-COSMETIC-CORRECTION-CRM_rollback.sql` §A — #2a seller→NULL 복원 / #5 seller→최민지(03642b85) 복원. per-row PK + 현재값(=김규리) 가드.

## apply 게이트 순서
supervisor dry-run 검토(본 문서 + `_05` 스크립트 dry-run 동봉) → `node scripts/..._05_trackA_reattr_apply.mjs --apply` → 자동집계 재조회 = 중간기대값(711,000/22 UNCHANGED) 일치 확인 → `applied_at` + db_change evidence 5필드 갱신.

> Track B(4-PK soft-void, commit 9326fb7c)는 별도 게이트: supervisor DDL-diff(3컬럼 ADD mig 20260805110000) + FE co-deploy(MIG-GATE) + Tier-F 무접촉 landing.
> #3 김정숙 F-4872 = 별도 sub-HOLD(nph2 open, 4-PK freeze set 미포함, 무단 원장 INSERT 금지 유지).
