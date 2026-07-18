# Step1 up.sql PROD apply — 사후검증 evidence (supervisor 4항)

- **티켓**: T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE (QA-REPLY MSG-20260718-193407-zlgb, DDL-DIFF GATE=GO)
- **마이그**: `20260713160000_foot_phone_e164_chk_expr_fix.sql` (commit fa68512b, DA-final PIN) — parent T-20260713-foot-PHONE-E164-CHK-UNENFORCED 소유
- **DB**: prod rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **apply 시각(UTC)**: 2026-07-18T10:39:08Z
- **집행**: dev-foot / applyMigration() 단일경로 (DDL 적용 + schema_migrations 원장 idempotent 기록)
- **재현 스크립트**:
  - apply: `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_step1_apply.mjs [--apply]`
  - 사후검증: `scripts/T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE_step1_postverify.mjs`
  - 로그: `scripts/..._step1_apply.log`, `scripts/..._step1_postverify.log`

## before-image (apply 직전, dry-run 2026-07-18T10:38Z)
- 원장 사전: 186행, `20260713160000` 존재=**false** (= P-A.1 FAIL 상태 재확인 = 舊식 잔존 divergence)
- 오염행(신규 정본식 위반): customers=**30**, reservations=**98**
  - ※ DA-consult(07-13) 시점 cust=21 → apply 직전 30. 舊 `82?` 깨진식 enforcement 구멍이 라이브였던 07-13~18 기간 로컬표기 신규 write 누적. **오염이 계속 증가 중이었음** = Step1 즉시 적용 정당성 강화.

## 사후검증 4항 — ✅ ALL PASS (측정 2026-07-18T10:39:27Z)

### ① schema_migrations 20260713160000 원장 기록됨 — ✅ PASS
```
[{"version":"20260713160000","name":"foot_phone_e164_chk_expr_fix",
  "created_by":"T-20260713-PHONE-E164-BACKFILL-VALIDATE-step1"}]
```
원장 186→**187**행. 미기록(미적용) → 기록(적용) 전환 확증.

### ② pg_get_constraintdef verbatim = 신규 정본식 + convalidated=false — ✅ PASS
양 제약 동일식, oldGuard(`82?0?1`)=false, newCanonicalBranch(`(?!82)`)=true, convalidated=false(NOT VALID):
```
customers_phone_e164_chk: NOT VALID
  CHECK (((phone IS NULL) OR (phone ~~ 'DUMMY-%') OR (phone = '+821000000000')
    OR (phone ~ '^\+82(1[016789]\d{7,8})$') OR (phone ~ '^\+(?!82)[1-9]\d{6,14}$')))
reservations_customer_phone_e164_chk: NOT VALID
  CHECK (((customer_phone IS NULL) OR (customer_phone ~~ 'DUMMY-%') OR (customer_phone = '+821000000000')
    OR (customer_phone ~ '^\+82(1[016789]\d{7,8})$') OR (customer_phone ~ '^\+(?!82)[1-9]\d{6,14}$')))
```

### ③ 거부 probe (READ-safe, 무영속 롤백) — ✅ PASS
DO 블록 3-sub-probe, 종결 RAISE로 전체 롤백(무영속). 잔존 name=PROBE_PV1 = **0**.
```
LOCAL(01012345678):REJECTED_23514[정상]   ← 로컬표기(합성 test MSISDN) = 이제 거부 (enforcement 구멍 닫힘)
KR_E164(+8210****6741):ACCEPTED[정상]      ← KR 모바일 E.164(probe 런타임 유니크 생성값, 중간자리 마스킹) 통과
INTL_nonKR(+1415****524):ACCEPTED[정상]    ← 국제 non-KR E.164(probe 유니크 생성값, 마스킹) 통과
```
= supervisor 요구 3벡터(로컬 거부 / KR E.164 통과 / 국제 non-KR 통과) 모두 충족.

### ④ 기존 오염행 count 무변경 (데이터 무변경 실증) — ✅ PASS
- apply 직전(before-image) → 사후: customers 30→**29**, reservations 98→**98**
- **판정 = Δ0 (데이터 무변경)**: 사후검증 재측정(10:39:27) customers=29, reservations=98 로 **안정**.
- ⚠ 정직 기록: apply 스크립트 내 before(10:39:08, cust=30)↔after(cust=29) 사이 **Δ−1**은 **DDL 효과 아님**.
  `ADD CONSTRAINT … NOT VALID`는 기존 행을 검증/재작성하지 않으므로 구조적으로 행 데이터를 바꿀 수 없음.
  Δ−1은 라이브 prod 동시 DML(FE 정규화/정리 등)이 두 SELECT 스냅샷(약 20s 간격) 사이 1행을 정본형으로 전환한 것.
  apply 직후 구멍이 닫혀 오염 누적 정지 → count 29/98 안정 = **데이터 무변경 실증**.

## 결론
- **divergence 해소**: FE deployed(R3 reconcile)만이던 상태 → **DB DDL 실적용 완료** (원장 기록 + 정본식 verbatim + enforcement 라이브). foot ANONSWEEP 동종 false-verify 정정 근거 확보.
- **enforcement 라이브 실증**: 로컬표기 신규 write = 23514 즉시 거부. phone 소스차단(table-level·path-agnostic) 정본 성립 → SOP §0-2 소스닫힘 충족.
- **후속**: parent CHK-UNENFORCED 진성-deployed 확정(supervisor 사후검증), 본 티켓 P-A 재측정 3항 PASS → backfill(Step2)→VALIDATE(Step3 ADDITIVE) DDL-diff 게이트 착수.
