# T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — PROD apply evidence

- **apply 시각**: 2026-08-10 01:09 KST (GO-token TTL 창 내, issued 00:57 / expires 01:42 KST)
- **prod_ref**: rxlomoozakkjesdqjtvd
- **runner**: `scripts/apply_20260806194000_194100_194200_foot_grade_enum_insert_validate.mjs --apply`
- **DB-GATE**: assertApplyGateForRunner 통과 — go_issued_at=2026-08-09T15:57:58.859Z · sql_sha256=`ad0832e3d93b603c52f8cccd79252b95e5ffa8159537f5f3d87b3398bd7155b6` · key_id=supv-dbgate-2026a
- **content-binding**: combined concat(no-sep, apply_order 194000∥194100∥194200) sha256 = `ad0832e3…55b6` (토큰 migration_sha256 정확일치)
  - per-file: 194000=`5d9ccf57…5535` · 194100=`74a67129…0b2e` · 194200=`f76f2a16…81c0` (전건 일치)

## 적용 결과 (exit 0)
3-마이그 원자 적용 완료 + schema_migrations 3 row 기록:
- ① 20260806194000 AC-0 값-집합 near_poor·veteran 추가 — ledger recorded: true
- ② 20260806194100 AC-1/AC-2 INSERT-path 가드 트리거 — ledger recorded: true
- ③ 20260806194200 AC-4 legacy manual 등급 정규화 backfill — ledger recorded: true

## POSTCHECK (READ-ONLY prod probe, `probe_T-...VALIDATE.mjs --post`, 2026-08-09T16:09:26Z)
1. **customers.insurance_grade CHECK = 11값** ✅ (general, low_income_1/2, medical_aid_1/2, infant, elderly_flat, foreigner, unverified, **near_poor, veteran**)
2. **update_insurance_grade(uuid,text,text,text)** secdef=true · np=true vet=true · **md5=`1fbcb8c62162953ad7e56f0108e5c62b`** len=2428
   - ⚠ **주의(supervisor POST-VERIFY)**: 이 md5는 **PRE-apply `06bb9201…`(C10 preflight 값)에서 변경됨**. 이는 **의도된 변경** — 194000 이 `CREATE OR REPLACE update_insurance_grade` 로 allowlist 2값(near_poor·veteran)을 추가하므로 prosrc 가 바뀌어 md5 변경은 필연. np=true·vet=true 로 확장 실증. (apply 후에도 md5가 06bb9201 그대로였다면 오히려 194000 미반영 신호.)
3. **trg_service_charges_grade_rate_guard** BEFORE INSERT ON service_charges 실재 1건 ✅ + guard fn `foot_service_charges_grade_rate_guard()` 실재 (md5 5ddd95b8…)
4. **backfill**: service_charges manual(전체)=0 · manual(지문일치)=0 · unverified(전체)=25 ✅ (manual 20건→unverified 정규화 완료)
5. **freeze archive** `_backfill_sc_manual_grade_20260806` 실재, **20 행** ✅
6. **schema_migrations 원장 3버전**: [20260806194000, 20260806194100, 20260806194200] ✅

## post-apply E2E green-run
`npx playwright test tests/e2e/T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE.spec.ts` — **7 passed (11.0s)**
- A (AC-1) grade=manual INSERT → 거부(sentinel) ✅
- B (AC-1) grade='일반' INSERT → 성공 + 'general' 정규화 ✅
- C (AC-2) rate=NULL INSERT → 거부(applied_rate 필수) ✅
- D (AC-1) grade=near_poor + rate INSERT → 성공(canonical 통과) ✅
- E (AC-0) customers.insurance_grade = near_poor/veteran → 성공(CHECK 확장) ✅
- F (AC-0) customers.insurance_grade = 비-canonical → CHECK 거부 ✅

## 다음
→ supervisor POST-VERIFY 회부 (독립 read-only prod 재확인 후 `status: deployed` 마킹, C29 live-bundle 재대조 포함). 현장 slack=N/A (내부 TK-ACC-2 · slack_channel null).

---

## POST-VERIFY 재확인 (신규 GO-token 창, 2026-08-10 01:17 KST)

supervisor 신규 GO-token(MSG-20260810-011508-c2mm · issued 2026-08-10T01:14:23 KST · expires 01:59:23 · nonce=1c2ef8a4ccaa775f)을 수신했으나, **apply 는 직전 GO-token(nonce=4b6863d8·issued 00:57)으로 01:09 KST 에 이미 원자 완료·커밋(cb20d945)·push(origin/main==HEAD) 되어 prod 에 영속된 상태**였다.

- 신규 토큰은 migration_sha256=`ad0832e3…55b6`·key_id·prod_ref 동일, **nonce/timestamp 만 상이 → 동일 content 계약의 재서명(redundant re-sign)**. 재-apply 는 이미 최종상태인 prod 의 불필요·위험한 재변이(194100 CREATE TRIGGER / 194200 archive-table 재생성 시 오류 위험)이므로 **미실행**.
- **READ-ONLY POSTCHECK 재실측** (`probe_...VALIDATE.mjs --post`, 2026-08-09T16:17:25Z) — 6항 전건 green 재확인:
  1. customers.insurance_grade CHECK = **11값**(…near_poor, veteran) ✅
  2. update_insurance_grade(uuid,text,text,text) secdef=true **md5=`1fbcb8c62162953ad7e56f0108e5c62b`** len=2428 np=true vet=true ✅
  3. trg_service_charges_grade_rate_guard BEFORE INSERT 실재 1건 + guard fn md5=`5ddd95b8…` ✅
  4. backfill: manual(전체)=**0** · manual(지문)=0 · unverified=**25** ✅
  5. freeze archive `_backfill_sc_manual_grade_20260806` = **20 행** ✅
  6. schema_migrations 원장 = [20260806194000, 20260806194100, 20260806194200] ✅
- **post-apply E2E 재-green** (`T-20260629-...VALIDATE.spec.ts`) — **7 passed (10.2s)**, A~F 전건 PASS, teardown 픽스처 스윕 완료.

→ **잔여 없음. supervisor 독립 POST-VERIFY 회부** (update_insurance_grade md5 · CHECK 11값 · 트리거 · backfill 독립 재확인 후 `status: deployed` 마킹, C29 포함). 신규 토큰 파일(01:14 재서명본)만 리포지토리에 반영.
