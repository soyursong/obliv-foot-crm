# DB-Gate 이관 — T-20260611-foot-DISCHARGED-DASH-RXMUTATE-LOCK

> **to**: supervisor (DB 게이트) · **from**: dev-foot · **db_change**: YES
> **commit**: d362502 (FE 누수 close + 가드 + audit FE/SQL) — push 완료(main=origin/main)
> **data-architect CONSULT**: 신규 테이블 1개(rx_audit_log) → §S2.4 자문 게이트 동반 권고

## 무엇을 적용하나
`rx_audit_log` 신규 테이블 1개 — 진료대시보드/진료환자목록 인플레이스 처방 mutate(처방 적용/취소/되돌리기/확정 + **차단된 시도**)의 차트변경 내부로그(audit).
대표원장(U0ALGAAAJAV) 요청: "처방 적용/취소/확정 다 내부로그 남겨야 함. 차단된 시도도."

- forward: `supabase/migrations/20260611210000_rx_audit_log.sql`
- rollback: `supabase/migrations/20260611210000_rx_audit_log.rollback.sql`

## 안전 설계 (검수 포인트)
1. **PII/RRN 평문 0**: 환자 식별은 FK(`check_in_id`/`customer_id`)만. 본문은 약물요약(`before_summary`/`after_summary`, 약물명/용법/건수 200자 캡)만. 이름·RRN·연락처 컬럼 없음.
2. **append-only**: INSERT/SELECT policy만. UPDATE/DELETE policy 없음 → 감사 무결성(service_role만 정리 가능).
3. **RLS clinic 격리**: INSERT/SELECT 모두 `check_in_id ∈ (본인 staff.clinic_id 소속 check_ins)` — clinic_id FE 누락 케이스도 check_in 소유로 판정(우회 0). clinic_events RLS 패턴 준용.
4. **action CHECK 제약**: 7값 enum(rx_apply/cancel/undo/confirm + *_blocked 3종). surface CHECK 5값.
5. **FK on delete**: check_in CASCADE / customer·clinic SET NULL — 원본 삭제 시 로그 정리/보존 합리적.

## 무중단 보장 (적용 전/실패해도 진료 안 멈춤)
- FE `logRxAudit` 는 **best-effort(fire-and-forget, try/catch 무시)**. 테이블 미존재·RLS 거부여도 처방 적용/취소/차단 동작 무중단.
- **FE 누수 close(1순위, AC-1/2/3/5/6)는 무DB 의존** → 이미 prod 유효. 본 DB 게이트는 **audit 적재(AC-4)만** 활성화.

## 적용 절차 (권고)
1. dry-run: 트랜잭션 내 적용 → `\d rx_audit_log` + policy 확인 → ROLLBACK (prod 무변경 확인)
2. data-architect CONSULT: cross_crm_data_contract — 신규 audit 테이블 PII-free 적합성 확인
3. forward 적용 → RLS 활성 확인(`enable row level security`) → INSERT/SELECT policy 2개 확인
4. 검증: staff 계정으로 처방 적용 1건 → rx_audit_log 에 actor/action/surface/약물요약 1행 적재 + 타 clinic 격리(교차조회 0) 확인. 귀가환자 처방취소 시도 → `rx_cancel_blocked` 1행 + 차단 동작 확인.
5. 이상 시 rollback SQL 적용(테이블+policy+index drop, FE 무영향).

## 회귀 가드
- rx_audit_log 는 **신규 테이블** — 기존 read/write 경로 무영향(기존 쿼리가 참조 안 함).
- check_ins/customers/clinics/staff 스키마 **무변경**(FK 참조만).
