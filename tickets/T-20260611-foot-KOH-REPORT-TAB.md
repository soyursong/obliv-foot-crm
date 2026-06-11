---
ticket_id: T-20260611-foot-KOH-REPORT-TAB
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-11
deploy_ready_at: 2026-06-12
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260611-foot-KOH-REPORT-TAB.spec.ts
db_changed: false
rollback_sql: ""
risk_level: GO (0/5)
commit_sha: b64e444
---

## 요청

원천: NEW-TASK MSG-20260612-070933-3qod (planner, P2). 방향 = 옵션 B(Phase 분리) 확정.
진료대시보드에 KOH(진균) 검사 시행 환자 명단 리포트 탭(균검사지) 추가.

**Phase 1 (본 티켓) = 산출 가능 4컬럼만 read-only 출시:**
환자이름(customers.name) · 생년월일(customers.birth_date) · 차트번호(customers.chart_number) · 검사일(check_in_services.created_at)

발톱부위·당일의사명은 Phase 1.5(T-20260612-foot-KOH-REPORT-PHASE15, blocked)로 분리 — 본 탭 미포함.

## 1. 변경 내용

- **신규**: `src/components/doctor/KohReportTab.tsx` — 균검사지 탭 컴포넌트(read-only).
  - KOH 매칭: `check_in_services.service_name ILIKE '%KOH%' OR '%진균검사%'` (denormalized name 기반).
    ⚠ service_code/hira_code 매칭 금지 — DX-KOH-01(미존재)·D6591/D2502001(비활성). 실서비스명 '일반진균검사-KOH도말-조갑조직'(D620300HZ active).
  - 데이터 경로: `check_in_services` → `check_ins!inner(clinic_id, customer_name)` → `customers(name, birth_date, chart_number)`.
  - 표기명 = customers.name 우선, check_ins.customer_name fallback.
  - 검사일 = created_at(UTC) → KST 'YYYY-MM-DD HH:mm' 변환. 월 네비게이터(YYYY-MM, KST 범위 바운드) + 이름/차트번호 클라이언트 검색.
- **수정**: `src/pages/DoctorTools.tsx` — 탭 3번째 '균검사지'(FlaskConical) 추가(컨테이너만, DoctorCallDashboard 미접촉).

## 2. DB / 데이터 정책

- **db_changed: false** — read-only(SELECT only). 신규 컬럼·테이블·enum 0 → data-architect CONSULT 게이트 불요(§S2.4 해당 없음). supervisor DB게이트 불요.
- AC-0 조사: `db-gate/T-20260611-foot-KOH-REPORT-TAB_ac0_evidence.md`.

## 3. 검증

- build: PASS (3.66s, DoctorTools 청크 포함).
- 로직 spec: 16/16 PASS (KOH 매칭식 / 4컬럼 매핑+이름 fallback / 월이동·범위바운드 / 표시포맷 / Phase 컬럼경계).
- 인증 브라우저 E2E(실데이터): `/admin/doctor-tools` → 균검사지 탭 → 2026년 6월 **18건 렌더** 확인.
  - 이름=이서연 / 생년월일=—(null 정상) / 차트=F-1541 / 검사일=2026-06-11 11:17(KST 변환 정상) / 검색 'F-1541'→1건.
- DB 쿼리(인증 세션) 동일 쿼리 18건 반환 — RLS·임베드·필터 정상.

## 4. supervisor field-soak 권장

prod `/admin/doctor-tools` → '균검사지' 탭:
1. 이번 달 KOH 검사 명단이 4컬럼(이름·생년월일·차트번호·검사일)으로 표시.
2. 월 ◀▶ 이동 + '이번 달' 복귀 동작.
3. 이름/차트번호 검색 필터 동작.
4. 검사일이 KST로 표시(UTC 09:00 보정).
5. 콘솔 에러 0 (PC·태블릿).
6. 발톱부위·의사명 컬럼 미노출 확인(Phase 1.5 분리 준수).
