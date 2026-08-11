# DB-GATE — T-20260811-foot-CHARTEDIT-TRIAL-PRICE-BACKFILL

**분류**: Data-Correction Backfill (per-row, freeze-only) · script_only (UI/코드 산출물 0)
**부모**: T-20260808-foot-CHARTEDIT-SESSIONTYPE-PRICE-RELINK (forward-fix deployed a224c81d) — AC-5 소급보정 별건 트랙
**DA GO**: MSG-20260809-103725-vtux (조건부 GO, 재개조건=필드 owner per-row 4행 명시 demand 충족)
**대상 테이블/필드**: `package_sessions.unit_price` (원장 무접촉)

## 요청 정정
통계>담당치료사별>이정인>차감기준 체험권 4건 unit_price 0원 → 각 package trial_unit_price(=10,000).

## G-gate (READ-ONLY, service_role) — PASS
술어: `performed_by=이정인(eed1d06d-…) AND session_type='trial' AND session_date IN ('2026-08-06','2026-08-07')`
→ 술어 전건 **4행**(unit_price 무관 전건이 0 = 모호성 없음), chart∈{F-5537,F-5727,F-5668,F-5538} 정확 4행, 중복/누락 0.

| PK | chart | 고객 | session_date | unit_price(before) | trial_unit_price(SET) | status | deleted_at |
|----|-------|------|--------------|--------------------|-----------------------|--------|------------|
| 57398393-4911-4eb0-a413-d8440b6b2b04 | F-5537 | 차민주 | 2026-08-07 | 0 | 10,000 | used | null |
| d29b8665-910f-4c6b-8296-cd17f0a80823 | F-5727 | 정석현 | 2026-08-07 | 0 | 10,000 | used | null |
| 63157a7a-88bc-472c-9633-6aa710ca1373 | F-5668 | 우경아 | 2026-08-06 | 0 | 10,000 | used | null |
| b9eed069-ca0d-454e-b3a9-ed3d17353060 | F-5538 | 강득중 | 2026-08-06 | 0 | 10,000 | used | null |

- SET 값 = 각 행 `packages.trial_unit_price` 실값 (하드코딩 아님). 4행 전부 실값 10,000 == owner 기대 → ABORT 조건 미해당.
- 복구 매출 영향(4행 합계): **40,000원**.

## 가드 이행
1. ✅ READ-ONLY G-gate 선결 → 정확 4행 freeze (blanket count UPDATE 아님).
2. ✅ archive-first: `rollback/T-20260811-…_archive_before.json` (before-image 4행, 가역) + `rollback/…_rollback.sql`.
3. ✅ per-row·freeze만: 확정 4 PK에만 UPDATE. DA blanket-EXCLUDE zero-snapshot 40행 버킷 中 owner per-row demand 4행만 — 나머지 36행 및 임의 확장 무접촉.
4. ✅ apply−1 re-freeze DRIFT ABORT: `_apply.mjs` STEP 1 내장 (before-image 불일치 시 exit 2).
5. ✅ 원장 무접점: payments/purchase/service_charges 무접촉, package_sessions.unit_price 스냅샷만.
6. ⏸ apply 순서: dry-run(무영속) evidence 완료 → **supervisor 검증·DB-GATE GO-token 발행 대기** → GO-token 후에만 prod apply. (현시점 prod UPDATE 0건, apply_before_go 준수.)

## 산출물
- `scripts/T-20260811-…_ggate.mjs` — READ-ONLY G-gate + dry-run (실행 로그 = 위 표)
- `scripts/T-20260811-…_apply.mjs` — prod apply (GO-token `--go=<path>` 필수, re-freeze/rowcheck/POSTCHECK 내장). **미실행.**
- `rollback/T-20260811-…_archive_before.json` / `_rollback.sql`

## POSTCHECK 계획 (apply 후)
- 4행 unit_price == 각 package trial_unit_price(10,000) / 4행 외 무변경(diff=정확4행) / 통계 이정인 차감기준 4건 10,000 반영 / archive 경로 기록.

## GO-token 요청
supervisor DB-GATE 검증 → GO-token 발행 요청 (dry-run evidence 첨부). GO 발행 후 `node scripts/T-20260811-…_apply.mjs --go=<token경로>` 집행.
