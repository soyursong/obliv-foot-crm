# P-A 실효 실측 — T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE

- 담당: dev-foot (supervisor 공동검증 대기)
- 측정시각(UTC): 2026-07-18T10:27Z (KST 19:27)
- 성격: READ-safe / READ-only. probe = 무영속 롤백(DO 블록 RAISE), 잔존행 0 확인.
- prod: Supabase rxlomoozakkjesdqjtvd (Management API /database/query)
- 재현: `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_PA_readonly.mjs`, `..._PA3_probe.mjs`

## 결론: **P-A = FAIL (3항 중 1·2 FAIL, 3 = 구멍 실증)** → CHECK apply 선행. 백필 mutation 금지.

핵심 divergence 확증: 티켓 T-20260713-foot-PHONE-E164-CHK-UNENFORCED status=deployed(FE R3 reconcile 근거)
이나 **DB계층 마이그(20260713160000)는 prod 미적용** = FE-live ≠ DB-applied. foot ANONSWEEP false-verify 동종.

## P-A.1 — schema_migrations 20260713160000 원장 실재
- 조회: `SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20260713160000'` → `[]`
- 판정: ❌ **FAIL** — 원장 미기록 = 미적용.

## P-A.2 — pg_get_constraintdef verbatim (신규 정본식 여부)
현재 prod 실재 (양 제약 동일, 舊 82? 음성가드):
```
customers_phone_e164_chk:
  CHECK (((phone IS NULL) OR (phone ~ '^\+82(1[016789]\d{7,8})$') OR (phone !~ '^\+?82?0?1[016789]'))) NOT VALID
reservations_customer_phone_e164_chk:
  CHECK (((customer_phone IS NULL) OR (customer_phone ~ '^\+82(1[016789]\d{7,8})$') OR (customer_phone !~ '^\+?82?0?1[016789]'))) NOT VALID
```
- 신규 정본식 마커 `(?!82)` 해외 E.164 분기 = **부재**. 舊 `82?0?1` 깨진 음성가드 = **잔존**.
- 판정: ❌ **FAIL** — 舊식 verbatim. up.sql(DA-final PIN 확정식) 미반영.

## P-A.3 — 거부 probe (무영속 롤백 write 시도, 실 배포 제약 강제 측정)
- probe A `phone='01012345678'` (로컬 KR모바일) → **ACCEPTED [구멍]**  (신규식이면 23514 거부 기대)
- probe B `phone='+8210…'` (SQL-생성 유니크 KR E.164, 하드코딩 phone 회피) → **ACCEPTED [정상]**
- 무영속 확인: `name IN (PROBE_PA3, PROBE_PA3B)` 잔존 = 0
- 판정: ❌ 로컬표기가 현 prod 제약을 통과 = enforcement 구멍 라이브 실증 (舊 깨진식 근본원인 그대로).

## SOP §0-2 (소스닫힘) 미충족
CHECK 미적용 = phone write-path DB계층 차단 부재. 소스닫힘 실증 실패 → 백필 GO 자동 hold(mutation 0).
P-B(neg-window)는 "실효확증 시각↑" 을 기준으로 하는데 실효확증이 성립하지 않으므로 **P-B 창 미개시** = 미실행.

## 권고 (dev-foot → planner)
1. **Step1(T-20260713-foot-PHONE-E164-CHK-UNENFORCED) up.sql prod 실적용** 선행 — supervisor DDL-diff 단일게이트.
   (마이그 파일·dryrun·rollback 준비완료, commit fa68512b. 무영속 dry-run 이 실제 apply 로 승격되어야 함.)
2. Step1 티켓 status=deployed → **false-verify 정정** (DB 미적용 실측 근거 첨부). R3 reconcile 가 FE 번들만 보고 DB DDL 적용을 확인 못한 케이스.
3. apply 후 P-A 재측정 3항 PASS → 본 티켓 백필(freeze→transform→triage→before-image→UPDATE→사후정합)→VALIDATE 연속 재개.
