# T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT — AC-2 적용 로그 (2026-06-15 ~20:55 KST)

게이트: DA CONSULT GO + supervisor DDL-diff GO 통과분(#A expedite, #3 후순위) 적용 시도.
prod = rxlomoozakkjesdqjtvd (pooler 직결). 모든 적용 전 dry-run/probe(read-only) 선행.

---

## #A 20260520000010_insurance_claims_schema — ✅ 적용 완료 (2026-06-15 ~21:25 KST, 옵션 A 개명본)

게이트: DA-20260615-foot-INSURANCE-CLAIM-NAMING(옵션 A GO) + supervisor 재-DDL-diff GO(21:20, commit 7578162). autonomy §3.1(ADDITIVE+DA GO → 대표게이트 면제).

### dry-run(적용 전, read-only)
- insurance_claims/claim_items/insurance_claim_diagnoses/edi_submissions ❌ 전부 부재 (= live 42P01 RC 확인)
- live claim_diagnoses 지문: 정책 `claim_diagnoses_auth_all`, 8컬럼(disease_code 포함), rows=4

### `--apply` 결과 (multi-statement 단일 트랜잭션)
- 신규 4테이블 ✅ 전부 생성. RLS enabled ✅×4. 정책 1개씩 ✅×4. NOTIFY pgrst reload 완료 → **42P01 소멸**.
- **🛡️ live claim_diagnoses 무변경 검증 PASS**: 적용 전/후 정책·컬럼·행수 100% 동일(JSON 지문 일치). DRIFT 재발 0. (옵션 A 개명으로 동명충돌 제거된 효과 실증)

### supervisor 검증 5포인트 사후 확인 (독립 쿼리)
| 포인트 | 결과 |
|--------|------|
| (a) prod live claim_diagnoses 미접촉 0건 | ✅ 지문 불변(정책/컬럼/rows=4) |
| (b) 새 테이블명 insurance_claim_diagnoses만 존재 | ✅ pg_policies = `insurance_claim_diagnoses_auth_all` |
| (c) 신규 RLS canonical + anon 차단 | ✅ `is_approved_user() AND clinic_id=current_user_clinic_id()`, roles={authenticated}. anon SELECT 시 **0 rows**(RLS row-block) |
| (d) down.sql 신규 테이블 한정 | ✅ 신규 4테이블만 DROP (live claim_diagnoses 미포함) |

### ⚠ 비차단 노트 (supervisor 판단 요청)
- `has_table_privilege('anon', 'insurance_claims', 'SELECT')` = true → **Supabase public 스키마 플랫폼 기본 GRANT**(전 테이블 공통). RLS enabled + 정책 `TO authenticated` 단독이라 anon 실 row 접근 = **0건**(시뮬 검증 완료). 데이터 노출 0. PHI 인접이라 명시적 `REVOKE ... FROM anon` 하드닝을 원하면 별건 follow-up 가능(현 상태도 안전). supervisor/data-architect 결정.

→ **#A CLOSED (apply 완료, 42P01 해소).**

---

## (이전 기록) #A 20260520000010_insurance_claims_schema — ⛔ 적용 실패(자동 롤백) / DRIFT-COLLISION 발견 (개명 전, 보존용)

### 시도 결과
- dry-run: insurance_claims ❌부재 / claim_items ❌부재 / **claim_diagnoses ✅존재** / edi_submissions ❌부재
- `--apply` → 오류 `column "claim_id" does not exist` → **multi-statement 단일 트랜잭션 자동 롤백**(부분생성 0 확인). prod 무변경.

### RC = 테이블명 충돌(DRIFT), 단순 부재 아님
prod 의 기존 `claim_diagnoses` 는 마이그 #A 가 만들려는 것과 **다른 기능의 동명이표(同名異表)**:

| | prod 실재 (rows=4, RLS `claim_diagnoses_auth_all(ALL)` 보유) | 마이그 #A 기대 |
|---|---|---|
| 컬럼 | id, **payment_id**, **package_payment_id**, clinic_id, **disease_code**, disease_name, sort_order, created_at | id, **claim_id→insurance_claims**, **kcd_code**, is_primary, sort_order, created_at |
| 성격 | 결제/패키지 연계 진단(별도 기능, 실데이터 4건·PHI) | 건보청구 상병(claim_id FK) |

→ 마이그 #A 의 claim_diagnoses 블록:
1. `CREATE TABLE IF NOT EXISTS claim_diagnoses` = **skip**(이미 존재) → 구조 불일치 잔존
2. `DROP POLICY IF EXISTS claim_diagnoses_auth_all` → **live PHI 테이블의 보호 정책 제거**(파괴적 부작용)
3. `CREATE POLICY ... USING (claim_id IN ...)` + `CREATE INDEX ...(claim_id)` → **claim_id 부재로 실패**

### 판정: AC-3 (drift/파괴적 경계) — 자동적용 금지. 에스컬레이션.
- DA·supervisor 게이트는 **마이그 파일 단독** 검토라 prod 동명이표 존재를 알 수 없었음 → "ADDITIVE" 전제가 prod 현실에서 깨짐.
- insurance_claims/claim_items/edi_submissions 3종은 깨끗(부재). 그러나 **monolithic 단일 파일/트랜잭션**이라 claim_diagnoses 충돌이 전체를 막음.
- 해결 = 네이밍 SSOT(data-architect 소유) 결정 필요. 옵션(제안, dev-foot 미결정):
  - (A) 건보청구용 테이블을 `insurance_claim_diagnoses` 로 개명 → 마이그 분할/수정 후 재-DDL-diff
  - (B) 기존 prod claim_diagnoses(결제연계)를 개명하고 마이그 claim_diagnoses 신설 — 단 기존 4건 데이터·FE 참조·RLS 이전 필요(파괴적, 비권장)
- **status: HOLD. planner FOLLOWUP + data-architect CONSULT 발행.**

---

## #3 20260607190000_pay_recon_port — ✅ 검증 깨끗(drift 0) / 적용 HOLD(시퀀스 "#A 후")

probe(read-only):
- 신규 3테이블 redpay_raw_transactions / payment_reconciliation_log / redpay_poller_state → 전부 ❌부재(신규대상, 충돌 0)
- payments 6컬럼: external_approval_no ✅ / external_tid ✅ / cancelled_at ✅ (기존 no-op, 마이그 헤더 명시와 일치) · reconciliation_status ❌ / reconciled_at ❌ / redpay_tid ❌ (ADD 대상, 전부 IF NOT EXISTS)
- → clean ADDITIVE 확인. 동명이표/drift 없음.

판정: 즉시 적용 가능하나 (a) 지시 시퀀스 "#3 후순위·#A 적용 후", (b) FE참조0·저긴급, (c) #A drift 로 배치 전제 재확인 필요 → **planner 재시퀀싱 지시까지 HOLD**. drift 회피 후 단독 적용 가능(독립).

---

## #7 / #C — supervisor spec_missing(파일부재) = 스테일 체크아웃 이슈, SSOT엔 존재

supervisor DDL-diff NO-GO 사유는 `/Users/domas/obliv-foot-crm`(스테일 클론, Jun15 01:43) 에 파일 부재. **SSOT `~/Documents/GitHub/obliv-foot-crm` + origin/main 에는 둘 다 존재(push 완료)**:
- #7 `20260614130000_reservation_is_healer_intent.sql` — commit **27caa21**, origin/main 포함. **컬럼 ADD only**(line11-12), backfill UPDATE 는 별도 `20260615T_is_healer_intent_backfill.datafix.sql` 로 분리됨(이 파일엔 UPDATE 없음).
- #C `20260611220000_room_assignments_staff_write_scoped.sql` — commit **5377d00**, origin/main 포함.
- → supervisor 가 본인 체크아웃 `git pull` 후 재-DDL-diff 하면 해소. (인프라: 양 머신 Git SSOT sync 점검 권고)
