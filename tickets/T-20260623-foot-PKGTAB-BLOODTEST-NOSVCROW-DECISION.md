---
id: T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION
domain: foot
status: deploy-ready
deploy-ready: true
db_change: true
build_ok: true
spec_added: tests/e2e/T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION.spec.ts
summary: "피검사 단독 검사신청 차단 해소(A안: KOH 패턴 미러) — request_blood_test_for_customer RPC 신규 + svcs.length===0 차단 게이트 제거"
migration: supabase/migrations/20260623160000_blood_request_for_customer.sql
rollback_sql: supabase/migrations/20260623160000_blood_request_for_customer.rollback.sql
da_consult: "GO (2026-06-23, MSG-l2hk): ADDITIVE CONFIRMED, 청구/통계 이중계상 SAFE(매출=payments-driven, price=0 placeholder 매출 미진입). 필수조건 (a)미러 INSERT price=0/original_price=0/is_package_session=false 고정 ✓(mig L85-86, KOH L99~105 동형) (b)롤백=KOH 패턴 미러 orphan placeholder 참조쿼리 blood_test_requested=true AND price=0 ✓ (c)prod 배포는 supervisor DDL-diff 후"
remaining_gate: "supervisor DDL-diff (잔여 유일 게이트). FE+RPC paired 배포 필수 — FE 가 신규 RPC 호출하므로 RPC 미적용 prod 단독 FE 배포 금지. 대표 게이트 면제(ADDITIVE+승인패턴 미러, autonomy §3.1)."
priority: P1
created_at: 2026-06-23
deployed_at: ""
---

# T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION

## 결정 (김주연 총괄)
"피검사/KOH 검사 신청 시스템으로 제약 걸지마, 현장 실장이 판단해 신청" → 단독 검사신청 = 정상 업무.
旣 prod 의 KOH 신청 패턴(request_koh_for_customer)을 피검사에 1:1 미러.

## 작업 (3)
1. **신규 RPC `request_blood_test_for_customer(p_customer_id, p_value)`** — request_koh_for_customer 미러.
   - ① 서비스 행 보유 내원(가장 최근, service_name 필터 없음) → 그 내원 행 전체 blood_test_requested 동기화(旣 FE 루프 보존).
   - ② 서비스 행 없음 + ON → 최근 non-cancelled 내원에 피검사 요청 행 신규 INSERT(price=0 마커, is_package_session=false).
   - ③ 서비스 행 없음 + OFF → no-op.
   - ADDITIVE 마이그(RPC 1건 신규, 컬럼/테이블/enum 무변경).
2. **BloodTestRequestToggle.tsx** — L142 `svcs.length===0` 차단 게이트 제거 + 쓰기를 행별 루프(set_blood_test_requested)
   → 단일 RPC 위임(request_blood_test_for_customer)으로 전환(KohRequestToggle L119~127 동형, 서버 SSOT). 노출 게이트(hasCheckIn, AC-4) 유지.
3. **KOH 잔여 제약 점검(점검만)** — KohRequestToggle/request_koh_for_customer 경로에 service 유무로 막는 잔여 제약 없음 확인.
   → KohRequestToggle 은 차단 게이트 없이 단일 RPC 위임(L155), RPC 가 이력없음 처리. **0 touch.**

## AC
- AC-1 단독 신청 허용: 서비스 행 없는 환자도 ON → 서버가 최근 내원에 피검사 요청 행 신규 생성.
- AC-2 보유 동기화 보존: 서비스 행 있으면 그 내원 행 전체 동기화(旣 동작 회귀 0).
- AC-3 OFF no-op: 서비스 행 없는 환자 OFF → 신규행 생성 안 함.
- AC-4 노출 게이트 유지: hasCheckIn 기준 노출(svcs 결과 무관).
- AC-5 신규행 마커: 자동생성 행 price=0·is_package_session=false(이중계상 방지).

## 게이트
- FE(게이트 제거)는 즉시 착수 — 코드 완료.
- **RPC 마이그 prod 배포는 data-architect CONSULT GO 후** → ✅ **GO 완료(2026-06-23, MSG-l2hk)**. ADDITIVE CONFIRMED, 청구/통계 이중계상 SAFE(매출=payments-driven, price=0 placeholder 매출 미진입, AC-4 충족). 게이트#2 통과.
  ADDITIVE+승인패턴 미러 → 대표 게이트 면제, **잔여 = supervisor DDL-diff만**.
- **FE+RPC paired 배포 필수**: FE 가 신규 RPC 를 호출하므로 RPC 미적용 prod 에 FE 만 배포 시 토글 깨짐(RPC 부재 에러).
  → CONSULT GO 수신으로 deploy-ready=true 전환(2026-06-23). 마이그는 dev-foot 직접 실행(대시보드 수동 금지). supervisor DDL-diff 후 paired 배포.

## CONSULT GO 필수조건 충족 (2026-06-23 MSG-l2hk)
- **(a) 미러 INSERT 불변식** ✅: mig L85-86 `price=0, original_price=0, is_package_session=false` 고정 — request_koh_for_customer L99~105 동형. (피검사 차이: service_id=NULL, service_name='혈액검사(피검사)' — 전용 카탈로그 부재)
- **(b) 롤백 마이그 = KOH 패턴 미러** ✅: rollback.sql — DROP FUNCTION + orphan placeholder 참조쿼리 `WHERE blood_test_requested=true AND price=0` (실행 안 함, 데이터 보존 = KOH 롤백 동형).
- **(c) 배포 순서** ✅ 준수: FE 게이트 제거 旣 commit(8fcde2dd), RPC 마이그 prod 배포는 supervisor DDL-diff 후.
- Known-limit(single_paid fan-out)=KOH 旣부담 구조성질, 본 미러 신규위험 아님 → 별도 stats-RPC 후속(본 건 scope 밖).

## 검증
- build OK (tsc + vite).
- E2E spec 9 PASS: C1(보유 동기화)/C2(단독신청 신규생성)/C2b(멱등)/C3(OFF no-op)/AC-5/내원없음예외/AC-4/스모크.
- apply 스크립트(probe): scripts/apply_20260623160000_blood_request_for_customer.mjs (TX ROLLBACK 검증, GO 후 prod 실행).
