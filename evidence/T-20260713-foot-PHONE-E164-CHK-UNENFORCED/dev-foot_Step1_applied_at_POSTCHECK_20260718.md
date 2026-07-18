# T-20260713-foot-PHONE-E164-CHK-UNENFORCED — Step1 applied_at POSTCHECK evidence

**작성**: dev-foot / 2026-07-18
**계기**: FIX-REQUEST MSG-20260718-193954-6j50 (supervisor) — Step1 DDL prod 실적용 + 원장기록 + applied_at POSTCHECK 요구.
**재현**: `scripts/T-20260713-foot-PHONE-E164-CHK-UNENFORCED_apply_postcheck.mjs --apply` (obliv-foot-crm repo)
**raw 로그**: `evidence/T-20260713-foot-PHONE-E164-CHK-UNENFORCED/postcheck_apply_final.log`

---

## 0. 상태 요약 (evidence-based, 추정 없음)

| 항목 | 결과 |
|------|------|
| Step1 DDL prod 실재 | ✅ 적용됨. prod 양 제약 = DA-final PIN 정본식, `convalidated=false`(NOT VALID) |
| schema_migrations 원장 20260713160000 | ✅ 기록됨 (name=`foot_phone_e164_chk_expr_fix`) |
| enforcement POSTCHECK | ✅ **12/12 PASS** (로컬폰 REJECT + KR/JP/CN E.164 ACCEPT, INSERT+UPDATE 양 테이블) |
| 오염 잔존행 (NOT VALID 유지) | customers=29 / reservations=98 — **Step2 백필 대상, 본 티켓 무접점** |

### FIX-REQUEST 전제 정정 (timeline)
- FIX-REQUEST는 "DB DDL 미적용 + 원장 미기록"을 전제로 발행되었으나, 이는 **R3 reconcile 시점의 stale 상태**였다.
- **2026-07-18T10:39:08Z**: 형제 티켓 `T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE` step1 apply가 **동일 마이그(20260713160000)를 forward-apply** → 원장 186→187행, 20260713160000 존재=true. (근거: `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_step1_apply.log`)
- 즉 FIX-REQUEST가 큐잉된 시점에는 이미 prod에 적용 완료 상태. up.sql이 멱등(DROP IF EXISTS + re-ADD NOT VALID)이므로 dev-foot가 **본 티켓 태그로 재적용(2026-07-18T10:54:45Z)**하여 commit fa68512b ↔ prod 정본식 parity를 재확증 + 아래 comprehensive POSTCHECK 산출.

---

## 1. 실적용 시각

- **applied_at (본 티켓 재적용)**: `2026-07-18T10:54:45.160Z` — `applyMigration(20260713160000, createdBy=T-20260713-CHK-UNENFORCED-fixreq)`, 원장 idempotent 기록(ON CONFLICT DO NOTHING).
- **최초 apply (형제 step1)**: `2026-07-18T10:39:08Z` (원장 created_by 소유).

## 2. prod 제약 def diff (舊식 → 정본식)

**정본식 (BEFORE=AFTER, 이미 교체 완료 상태 확인)** — 양 제약(`customers_phone_e164_chk`, `reservations_customer_phone_e164_chk`) 동일:
```
CHECK ((
  (phone IS NULL)
  OR (phone ~~ 'DUMMY-%')
  OR (phone = '+821000000000')
  OR (phone ~ '^\+82(1[016789]\d{7,8})$')      -- KR 모바일 E.164 strict
  OR (phone ~ '^\+(?!82)[1-9]\d{6,14}$')        -- ★국제환자 해외 E.164 (DA-final PIN)
)) NOT VALID
```
- 舊식(`phone !~ '^\+?82?0?1[016789]'` broken 음성가드) → **정본식 교체 완료**. `oldGuard=false / newBranch(?!82)=true`.
- `convalidated=false` (NOT VALID 유지 — 기존 오염행 무블록).

## 3. enforcement POSTCHECK (DO-block forced-rollback, **0 persistence**)

각 테스트는 `DO $$ ... RAISE EXCEPTION $$` 로 항상 롤백 → prod 데이터 무영속. clinic_id=실재값 고정(FK 오검출 회피 → 오직 CHECK만 실패 원인). 판정: REJECT=SQLSTATE 23514(check_violation, phone_e164_chk) / ACCEPT=SQLSTATE P0001(ROLLBACK_OK, INSERT 통과 후 강제 롤백).

| # | 대상 | 값 | 기대 | SQLSTATE | 판정 |
|---|------|-----|------|----------|------|
| 1 | customers INSERT | `01012345678` (KR local) | REJECT | 23514 | ✅ PASS |
| 2 | customers INSERT | `010-1234-5678` (KR hyphen) | REJECT | 23514 | ✅ PASS |
| 3 | customers UPDATE | `010-1234-5678` (KR hyphen) | REJECT | 23514 | ✅ PASS |
| 4 | customers INSERT | `+821012345678` (KR E.164) | ACCEPT | P0001 | ✅ PASS |
| 5 | customers INSERT | `+819012345678` (JP E.164) | ACCEPT | P0001 | ✅ PASS |
| 6 | customers INSERT | `+8613800138000` (CN E.164) | ACCEPT | P0001 | ✅ PASS |
| 7 | reservations INSERT | `01012345678` (KR local) | REJECT | 23514 | ✅ PASS |
| 8 | reservations INSERT | `010-1234-5678` (KR hyphen) | REJECT | 23514 | ✅ PASS |
| 9 | reservations UPDATE | `010-1234-5678` (KR hyphen) | REJECT | 23514 | ✅ PASS |
| 10 | reservations INSERT | `+821012345678` (KR E.164) | ACCEPT | P0001 | ✅ PASS |
| 11 | reservations INSERT | `+819012345678` (JP E.164) | ACCEPT | P0001 | ✅ PASS |
| 12 | reservations INSERT | `+8613800138000` (CN E.164) | ACCEPT | P0001 | ✅ PASS |

**SUMMARY: 12/12 PASS, 0 FAIL** → enforcement 구멍 닫힘 실증(로컬표기 전량 거부) + 국제환자 E.164 오거부 없음.

## 4. 오염 잔존행 (NOT VALID 유지 실증)

- customers_contam=29 / reservations_contam=98 (정본식 미매치 행). NOT VALID이므로 **블록되지 않고 잔존** = 설계대로.
- 정정은 **Step2** `T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE` (대표 게이트 + data_correction_backfill_sop) 소유. 본 티켓 무접점.

---

## 결론
Step1 DDL prod 실적용 + 원장 기록 + applied_at POSTCHECK(12/12 PASS) 확증. false-verify(db_not_applied) 완전 해소. Step2 백필/VALIDATE unblock.
