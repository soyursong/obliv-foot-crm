---
ticket_id: T-20260612-foot-KOH-REPORT-PHASE15
status: db-deployed
db_deployed: true
db_deployed_at: 2026-06-14
db_deployed_evidence: db-gate/T-20260612-foot-KOH-REPORT-PHASE15_evidence.md
priority: P2
domain: foot
created_at: 2026-06-12
build_ok: true
spec_added: tests/e2e/T-20260612-foot-KOH-REPORT-PHASE15.spec.ts
db_changed: true
rollback_sql: supabase/migrations/20260612160000_koh_nail_sites.rollback.sql
data_architect_consult: ticket §119~137 CONSULT-REPLY (확정 스키마)
db_gate: supabase/migrations/20260612160000_koh_nail_sites.sql (supervisor Gate3 대기)
db_gate_evidence: db-gate/T-20260612-foot-KOH-REPORT-PHASE15_dbgate.md
risk_level: GO (1/5 — DB 컬럼 ADD + 쓰기 RPC, FE-DB 순서 폴백 가드)
---

## 요청 (NEW-TASK MSG-20260612-205939-d47l, planner P2)

균검사지(KOH) Phase 1.5: 발톱부위(KOH 검사부위) 입력 UI + DB 마이그 + 당일 진료의사 조인.
3중 게이트 ALL GO(현장동선/data-architect CONSULT/supervisor DB게이트).

## A. 발톱부위 (koh_nail_sites)
- DB: `check_in_services.koh_nail_sites jsonb NOT NULL DEFAULT '[]'` (KOH 검사 인스턴스=1행=check_in_services 행).
  원소 `{side:Rt|Lt, toe:1-5}`. 구조만 저장(표시문자열 금지). status 없음. UI 단일선택(길이 0|1).
- 쓰기 RPC `set_koh_nail_sites`(SECURITY DEFINER, is_approved_user 게이트) — check_in_services UPDATE RLS(consultant+) 우회로 치료사 포함 승인 사용자 누구나 입력.
- UI: 균검사지 탭 명단 발톱부위 셀, R/L 2버튼 + 발가락 1~5 5버튼 + '조갑' 고정. 라디오형 단일선택 + 즉시저장.

## B. 당일 진료의사 (신규 스키마 ZERO)
- `medical_charts.signing_doctor_name`(deployed b65357e) read-only 조인. 키=customer_id+visit_date(검사일 KST).
- 1환자 N차트=합집합. 미서명/차트없음='미정'. live 패턴(useSigningDoctorsByDate) 재사용.

## C. 명단 표시
- 균검사지 명단에 발톱부위·당일진료의사 컬럼 추가. 과거분=빈값('—'/'미정').

## 게이트 위치
- ① 엔티티 식별 + SQL/롤백 ✅ → ② **supervisor DB게이트(Gate3) 대기** → ③ DB 적용 후 활성.
- 상세: `db-gate/T-20260612-foot-KOH-REPORT-PHASE15_dbgate.md`

## 검증
- build PASS / 신규 spec 8/8 PASS / Phase1 회귀 22/22 PASS.
- FE-DB 순서 안전장치: koh_nail_sites 컬럼 부재(42703) 시 select 폴백 → 마이그 적용 전 prod 도달해도 Phase1 탭 무회귀.
