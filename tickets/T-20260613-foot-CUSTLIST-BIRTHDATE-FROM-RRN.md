---
ticket_id: T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-13
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN.spec.ts
db_changed: true
rollback_sql: supabase/migrations/20260613120000_customer_birthdate_derive_rpc.rollback.sql
risk_level: GO (1/5)
commit_sha: ""
---

## 요청

원천: NEW-TASK MSG-20260613-235616-xon5 (planner, P1). 김주연 총괄 요청.
고객관리 화면 개선 — 생년월일 자동 표기 (RRN 파생).

핵심:
- customers.birth_date 컬럼은 이미 존재(YYMMDD 텍스트, 20260430000001 마이그). 행 값이 있으면 우선 표기.
- 값이 비면 암호화된 rrn 앞6자리(YYMMDD) + 7번째 자리(세기코드)로 파생.

⚠️ PHI 가드(필수):
- 풋 rrn 은 pgsodium/pgp 암호화. 클라이언트 평문 rrn 디코딩 금지.
- 서버 RPC(fn_customer_birthdates)가 서버측에서만 복호화 → birth_date(YYYY-MM-DD)만 노출.
- rrn 뒷자리·성별코드 화면 노출 0. anon(미인증) EXECUTE 회수.

## 구현

### DB (db_changed: true)
- `supabase/migrations/20260613120000_customer_birthdate_derive_rpc.sql`
  - `fn_customer_birthdates(p_clinic_id uuid, p_ids uuid[]) → TABLE(customer_id uuid, birth_date_display text)`
  - SECURITY DEFINER / STABLE / search_path=public,extensions.
  - 1순위 birth_date(YYMMDD, 세기 휴리스틱) → 2순위 rrn 복호화 후 YYMMDD+세기코드(1,2,5,6→1900s / 3,4,7,8→2000s / 9,0→1800s).
  - make_date 불가 날짜(2/30 등) 방어 → NULL.
  - REVOKE public/anon, GRANT authenticated.
  - 신규 컬럼/테이블/enum 없음 → data-architect CONSULT 게이트 비해당(read-only RPC).
- DB-gate evidence: `db-gate/T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN_evidence.md` (db_gate_status=PASS, 7/7).
  - 함수 존재·SECURITY DEFINER·rrn 평문 누출 라인 없음·authenticated EXECUTE·PUBLIC/anon 미부여·반환컬럼 {customer_id,birth_date_display}만.

### FE
- `src/lib/format.ts` — `birthDateYMD(yymmdd)` 헬퍼 추가(YYMMDD→YYYY-MM-DD, 세기 휴리스틱, 클라 fallback 전용, rrn 미사용).
- `src/pages/Customers.tsx` — runSearch Promise.all 에 fn_customer_birthdates RPC 추가 → birthMap 구성. 생년월일 셀: `birthMap.get(id) ?? (birthDateYMD(c.birth_date) || '-')`. data-testid="cust-birthdate".
- `src/components/CheckInDetailSheet.tsx` (고객 상세 customerMode) — customerMode 로더에서 RPC 호출 → birthDateDisplay. 연락처 아래 생년월일 라인 표기. data-testid="cust-detail-birthdate".

### E2E
- `tests/e2e/T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN.spec.ts`
  - AC-1 목록 생년월일 컬럼 YYYY-MM-DD|'-' 형식
  - AC-2 fn_customer_birthdates RPC 호출 발생
  - AC-3 PHI 가드 — 셀·RPC 응답에 주민번호 13자리 평문/rrn/gender 키 0
  - AC-4 고객 상세 패널 생년월일 표기 존재

## AC 매핑
- AC: 고객 목록 생년월일 컬럼 자동 표기(birth_date 우선, 없으면 rrn 파생) → Customers.tsx + RPC
- AC: 고객 상세 생년월일 표기 → CheckInDetailSheet customerMode
- AC: PHI — 평문 rrn 클라 미수신, 뒷자리·성별코드 노출 0 → SECURITY DEFINER RPC(birth_date만), anon 회수

## 리스크
- GO (1/5). DB는 read-only RPC(additive). 롤백=DROP FUNCTION. FE는 표기 전용(저장값 미변경).
- 빌드 OK (tsc+vite). 단계별 브라우저 테스트는 supervisor QA(맥스튜디오)에서 E2E 수행 권장.
