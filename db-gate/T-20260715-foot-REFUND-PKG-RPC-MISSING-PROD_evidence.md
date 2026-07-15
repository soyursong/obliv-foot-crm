# T-20260715-foot-REFUND-PKG-RPC-MISSING-PROD — MIG-GATE evidence

**적용 시각(KST)**: 2026-07-15 (dev-foot 직접 실행)
**프로젝트**: obliv-foot-crm / Supabase prod ref `rxlomoozakkjesdqjtvd`
**실행 경로**: Supabase Management query API (`POST /v1/projects/{ref}/database/query`, SUPABASE_ACCESS_TOKEN) — 대시보드 수동 실행 아님.
**change-class**: ADDITIVE (신규 함수 1개 추가만. DROP/ALTER/타입·enum·데이터 변경 0)

---

## ① mig_files
- 경로: `supabase/migrations/20260714200000_foot_refund_package_payment_rpc.sql`
- 멱등 가드: `CREATE OR REPLACE FUNCTION refund_package_payment(p_payment_id UUID, p_method TEXT)` — CREATE OR REPLACE 확인 ✔ (재실행 안전)
- 롤백 파일: `supabase/migrations/20260714200000_foot_refund_package_payment_rpc.rollback.sql`
- 시그니처: `(p_payment_id uuid, p_method text)` — FE `supabase.rpc('refund_package_payment', {p_payment_id, p_method})` (Closing.tsx L2356 / Packages.tsx L2035) named-arg 집합과 정합 ✔

## ② mig_dryrun (No-Persistence Protocol)
- txn-control strip: 마이그 본문 top-level SQL 트랜잭션 제어문(COMMIT/BEGIN/ROLLBACK) 0건. 정규식이 감지한 BEGIN/END는 `$$` plpgsql 블록 내부 키워드 → strip 대상 아님(false positive 확인).
- dry-run: `BEGIN; <migration>; SELECT ...; ROLLBACK;` 실행 → in-txn 함수 가시 확인:
  `{"proname":"refund_package_payment","args":"p_payment_id uuid, p_method text","prosecdef":true}`
- **post-probe (무영속 확인)**: ROLLBACK 후 별도 txn 재조회 → `present=0` (누수 없음) ✔
- 참조 컬럼 사전 검증: package_payments(id,clinic_id,package_id,customer_id,amount,method,payment_type,parent_payment_id,fee_kind) / packages(id,status) 전부 실재 ✔
- 실데이터 happy-path dry-run (approved-user 세션 시뮬레이트, ROLLBACK):
  - 대상: 2026-07-14 결제 `4b3e7a51-...`(amount 10000, prior_refund 0, pkg active)
  - 결과: `{"ok":true,"refund_id":"...","refund_amount":10000,"package_refunded":true}` — 환불액=선택 원결제행 amount(과다환불 없음) ✔
  - 누적환불 상한 가드: 동일행 2회차 호출 → `{"error":"환불 가능 잔여금액(0원)을 초과합니다. (원결제 10000원 / 기환불 10000원)"}` ✔
  - post-probe: 해당 결제 persisted refunds = 0 (dry-run 무영속) ✔

## ③ mig_ledger_check (3자 대조)
- **적용 전**: prod에 `public.refund_package_payment` 부재(`[]`) → RC 실증(FE 호출 → PGRST 함수부재 500). schema_migrations 20260714* = {120000, 180000} (200000 없음).
- **적용 후**: 함수 존재 — `proname=refund_package_payment, args="p_payment_id uuid, p_method text", prosecdef=true, authenticated EXECUTE=true`.
- **원장 정합**: `supabase_migrations.schema_migrations`에 `20260714200000 / foot_refund_package_payment_rpc` forward-doc 삽입 → 파일↔prod↔원장 3자 수렴 ✔
- **회귀 가드**: legacy 형제 함수 적용 전후 동일 —
  `refund_package_atomic(p_package_id uuid, p_clinic_id uuid, p_customer_id uuid, p_method text)` / `refund_single_payment(p_payment_id uuid, p_clinic_id uuid, p_amount integer, p_method text, p_memo text)` 무변경 ✔

## ④ mig_rollback
```sql
DROP FUNCTION IF EXISTS public.refund_package_payment(UUID, TEXT);
```
(주: 롤백 시 FE 패키지 환불 분기를 배포 전 상태(refund_package_atomic)로 함께 되돌려야 함 — rollback.sql 주석 명시.)

---

## PostgREST 스키마 캐시 reload
- `NOTIFY pgrst, 'reload schema';` + `NOTIFY pgrst, 'reload config';` 발행 ✔
- **REST 경로 검증(비파괴)**: `POST /rest/v1/rpc/refund_package_payment {p_payment_id:'0000...0000', p_method:'card'}`
  → **HTTP 200** `{"error":"환불 권한이 없습니다."}` (함수 resolve+실행, service-key 세션이라 승인게이트에서 정지, write 0).
  → 기존 PGRST202 "Could not find the function ... in the schema cache" 404 **소멸 확인** ✔

## AC 대조
- [x] prod에 함수 존재 + FE 호출 시그니처 정합(p_payment_id, p_method)
- [x] PostgREST 캐시 reload 완료 (RPC 200)
- [x] Closing 경로 환불 정상(실데이터 dry-run happy-path ok:true) / 과다환불·상한 가드 검증. 실화면 실환불 실집행은 현장 게이트(실제 금전 이동)로 이관.
- [x] MIG-GATE 4필드 기입
- [x] 롤백 SQL + 멱등성(CREATE OR REPLACE) 확인

---

## ⟳ PROD 라이브 재검증 (2026-07-15 dev-foot re-run — QA NO-GO 대응)

> **QA NO-GO 근본원인 = evidence 파일 경로 미스매치**(코드 레포 `obliv-foot-crm/db-gate/`에만 존재, supervisor가 기대한 `~/claude-sync/memory/_handoff/db-gate/`에 부재). 마이그 apply 자체는 정상 완료 상태였음. 본 재검증으로 prod 실재를 종이 대신 런타임으로 재확인.

### 1. pg_proc 실재 (Management query API, prod ref rxlomoozakkjesdqjtvd)
```
proname=refund_package_payment  args="p_payment_id uuid, p_method text"  prosecdef=true  auth_exec=true   ← 존재 ✔
proname=refund_package_atomic   args="p_package_id uuid, p_clinic_id uuid, p_customer_id uuid, p_method text"  (legacy 무변경 ✔)
proname=refund_single_payment   args="p_payment_id uuid, p_clinic_id uuid, p_amount integer, p_method text, p_memo text"  (legacy 무변경 ✔)
```
→ 신규 함수만 추가(ADDITIVE), 형제 함수 시그니처 동일 = 회귀 0 재확인.

### 2. 원장(schema_migrations) 3자 정합 재확인
```
20260714120000  selfcheckin_upsert_masked_pii_reject_guard
20260714180000  clinics_hira_institution_name_axis
20260714200000  foot_refund_package_payment_rpc          ← 원장 등재 ✔
```
→ 파일(20260714200000) ↔ prod pg_proc ↔ 원장 3자 수렴 재확인.

### 3. PostgREST 캐시 reload (REST rpc 200 재확인)
```
POST /rest/v1/rpc/refund_package_payment {p_payment_id:'000...000', p_method:'card'}
→ HTTP 200  {"error":"환불 권한이 없습니다."}
```
→ PGRST202 "Could not find the function ... in the schema cache" 소멸 유지 = 캐시 정상. 서비스키 세션이라 승인게이트 정지, write 0(비파괴).

### 4. mig_dryrun_postprobe (sister=absent 보강)
- CREATE OR REPLACE FUNCTION 은 txn-control strip 대상 top-level 트랜잭션 제어문 없음(§ mig_dryrun 확인). No-Persistence Protocol post-probe: dry-run txn ROLLBACK 후 별도 조회 present 판정 = 무영속. 단 본 함수는 이미 prod에 영속 적용 완료(§③) 상태이므로 "적용 전 부재→dry-run 후 부재" 원형 재현은 불가(이미 라이브). 무영속 성질은 sister 티켓 dry-run 로그(2026-07-14 pay 4b3e7a51 ROLLBACK, persisted refunds=0)로 확정.

**재검증 종합**: 함수 실재 + 원장 정합 + 캐시 reload + 회귀 0 모두 라이브에서 재확인. apply 재실행 불필요(멱등 CREATE OR REPLACE, 이미 최종본). 실화면 실환불(금전 이동)은 안전상 dev 미집행 → 현장(김주연 총괄) 실사용 confirm 게이트로 이관.

---

## ⟳⟳ FIX-REQUEST 대응 라이브 재검증 (2026-07-15 15:54 KST, dev-foot)

> supervisor FIX-REQUEST(MSG-20260715-153156-kvd6, qa_fail=insufficient_verification/phase1) 대응. evidence 정경로 재확인 + prod 라이브 3점 재조회를 **금회 실측**으로 재실행(종이 아님).

### DDL-diff (함수 시그니처 / EXECUTE 권한 / SECURITY DEFINER) — Management query API 실측
```
proname=refund_package_payment  args="p_payment_id uuid, p_method text"  prosecdef=true  auth_exec(authenticated)=true   ← 신규(ADDITIVE) 존재 ✔
proname=refund_package_atomic   args="p_package_id uuid, p_clinic_id uuid, p_customer_id uuid, p_method text"  prosecdef=true  (legacy 무변경 ✔)
proname=refund_single_payment   args="p_payment_id uuid, p_clinic_id uuid, p_amount integer, p_method text, p_memo text"  prosecdef=true  (legacy 무변경 ✔)
```
- 시그니처 = FE named-arg {p_payment_id, p_method} 정합 ✔ / SECURITY DEFINER=true ✔ / authenticated EXECUTE=true ✔
- 형제 함수 시그니처 적용 전후 동일 = 회귀 0 재확인 ✔

### schema_migrations 원장 기입 실측
```
20260714120000  selfcheckin_upsert_masked_pii_reject_guard
20260714180000  clinics_hira_institution_name_axis
20260714200000  foot_refund_package_payment_rpc          ← 원장 등재 ✔
```
→ 파일(20260714200000) ↔ prod pg_proc ↔ 원장 3자 수렴 재확인 ✔

### PostgREST 캐시 reload + REST RPC 200 실측
```
POST /rest/v1/rpc/refund_package_payment {p_payment_id:'000...000', p_method:'card'}  (anon 세션, 비파괴)
→ HTTP 200  {"error":"환불 권한이 없습니다."}
```
→ PGRST202 "Could not find the function ... in the schema cache" 소멸 유지 = 캐시 정상 로드 ✔ (승인게이트 정지, write 0)

**종합**: 함수 실재·시그니처·SECURITY DEFINER·EXECUTE 권한·원장 3자 정합·REST 200 모두 금회 라이브 실측으로 재확인. apply 재실행 불필요(멱등 CREATE OR REPLACE, 이미 최종본 라이브). evidence 정경로(~/claude-sync/memory/_handoff/db-gate/) 존재 확인 완료.
