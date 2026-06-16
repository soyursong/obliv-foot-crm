---
ticket_id: T-20260616-foot-KOH-SPECIMENNO-FORMAT
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-16
build_ok: true
spec_added: tests/e2e/T-20260616-foot-KOH-SPECIMENNO-FORMAT.spec.ts
db_changed: true
rollback_sql: supabase/migrations/20260616180000_koh_specimen_no_format.rollback.sql
data_architect_consult: 旣 ADDITIVE-GO(KOHTEST-LIFECYCLE) 스코프 내 포맷 핀 — 신규 DA CONSULT 불요(planner 명시)
db_gate: supabase/migrations/20260616180000_koh_specimen_no_format.sql (테이블 무변경·RPC body/시그니처만, supervisor DDL-diff Gate 대기)
risk_level: GO (1/5 — RPC body/시그니처만, 테이블/enum 무변경. 旣 미호출 함수 DROP→콜러 회귀 0)
deploy_ready: true
commit_sha: a7b31cf8
---

## 요청 (NEW-TASK, planner P2 — MSG-20260616-132019-84ws)

풋센터 균배양 검사 결과지 검체번호 자동배정 — 총괄 확정 포맷 반영.
旣 KOHTEST-LIFECYCLE-PUBLISH(commit d03b05ef/e13093f9) 구현 살림 — 그 위 포맷 수정·호출 활성. 재작업 X.

**확정 포맷:** `K + YYMMDD(6자리) + '-' + 고객 폰 뒷4자리`  예: `K260616-1234`
**중복 정책:** 같은 날 폰뒷4 충돌 OK → UNIQUE 제약/회피 로직 두지 말 것(공란없음이 목표).

## Acceptance Criteria

- **AC-1** RPC 변경: `next_koh_specimen_no(p_clinic, p_base_date, p_phone_last4 text)` → 반환 `'K'||to_char(p_base_date,'YYMMDD')||'-'||p_phone_last4`.
  기존 YYYYMMDD+3자리seq 포맷·seq/advisory-lock 로직 제거. 시그니처 인자 추가 → 旣 `(uuid,date)` DROP 후 신규 CREATE(미호출이라 콜러 회귀 0).
- **AC-2** 발행 호출 활성: `publish_koh_result` 의 주석된 `next_koh_specimen_no` 호출 해제 + phone 인자 전달. specimen_no = RPC override(FE 빈값 무시).
- **AC-3** phone 확보: `publish_koh_result` 내부에서 `customers.phone` 조회로 뒷4 확보(FE payload 확장 X, PHI FE 비노출). 미등록/4자리 미만 = 안전 패딩(`lpad '0'`), 발행 막지 않음.

## 구현

- `supabase/migrations/20260616180000_koh_specimen_no_format.sql`
  - `DROP FUNCTION next_koh_specimen_no(uuid,date)` → `CREATE next_koh_specimen_no(uuid,date,text)` (IMMUTABLE 순수 포맷, 테이블 무접근).
  - `publish_koh_result` CREATE OR REPLACE — phone 뒷4 추출(`right(regexp_replace(phone,'[^0-9]','','g'),4)` + `<4 lpad '0'`) + 검체번호 호출 활성 + specimen_no override.
  - `DO $verify$` 시그니처 교체 + 旣 시그니처 제거 + 포맷 단위검증(`K260616-1234`).
- `src/components/doctor/KohReportTab.tsx` — 주석 정합(검체번호 RPC 자동채번). FE 동작 무변경(specimen_no '' → RPC override).
- rollback: `..._koh_specimen_no_format.rollback.sql` (旣 LIFECYCLE-PUBLISH 상태 복원).

## 검증

- `npm run build` ✓ (4.31s)
- E2E `tests/e2e/T-20260616-foot-KOH-SPECIMENNO-FORMAT.spec.ts` — S1 정상삽입 / S2 같은날 폰뒷4 중복허용 / S3 phone 엣지 / S4 브라우저 스모크. **S1~S3 + setup = 4 passed**.
- DB 적용·검증(dev-foot 직접): 시그니처 `(uuid,date,text)` 단일 + 포맷 `K260616-1234` + 호출 활성 확정.
- db-gate evidence: `db-gate/T-20260616-foot-KOH-SPECIMENNO-FORMAT_dbgate.md`

## 게이트

- 자동채번 메커니즘 = 旣 DA ADDITIVE-GO(KOHTEST-LIFECYCLE) 스코프 → 포맷 핀이라 신규 DA CONSULT 불요.
- DB = RPC body/시그니처만(테이블 무변경) → 대표 게이트 면제, supervisor DDL-diff Gate만.
