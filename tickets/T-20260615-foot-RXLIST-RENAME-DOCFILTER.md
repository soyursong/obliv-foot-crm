---
id: T-20260615-foot-RXLIST-RENAME-DOCFILTER
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260615-foot-RXLIST-RENAME-DOCFILTER.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-15
assignee: dev-foot
reporter: planner (진료 대시보드 4항목 中 1·2번)
db-gate-handoff: null
---

# T-20260615-foot-RXLIST-RENAME-DOCFILTER

진료 대시보드 '처방 환자 목록' 탭 라벨 리네임 + 진료완료 고객만 표시.
(4항목 中 1·2번. 3·4번은 OPINIONCERT-DOCTAB-PUBLISH 로 분리·blocked)

## 구현 (FE-only, DB/EF/스키마 변경 0)

### item1 — 라벨 리네임 (텍스트만)
- `src/pages/DoctorTools.tsx`
  - 탭 텍스트 `진료 환자 목록` → `처방 환자 목록`.
  - ⚠ `value="patient_list"` / `data-testid="tab-patient-list"` 보존(E2E·탭 상태키 무변경).
  - L33 페이지 설명 노출문구 + 상단 도크 주석 일관 변경.
- `src/components/doctor/DoctorPatientList.tsx`
  - 내부 헤더 `진료 환자 목록` → `처방 환자 목록` (탭과 일관).

### item2 — 표시 필터 (원장 진료 완료 고객만)
- `src/components/doctor/DoctorPatientList.tsx` `usePatientsByDate`
  - 진료완료 판정 **SSOT = DoctorCallDashboard.completedPatients 필터(L504)와 글자 그대로 1:1 동일**:
    `completed_at 보유 OR status_flag === 'pink'`.
    (대조: 활성호출 = `status_flag==='purple' && !completed_at` → 완료필터와 상호배타)
  - `completed_at`(기존 check_ins 컬럼, DoctorCallDashboard CALL_SELECT 동일) SELECT 확장 + PatientRow 타입 추가.
  - queryFn 반환을 위 술어로 filter → 진료 대기중(purple)·진료 전(미호출) 행 제외.
  - 헤더 인원 표기 `N명 접수` → `N명 진료완료`, 빈상태 메시지 `진료 완료된 환자가 없습니다.` 로 정합.

## 회귀가드
- 진료 알림판·균검사지 탭 불변. 탭 value/data-testid 불변.
- 처방 현황 표시 로직(처방전 O/X 배지·요약·확정 동선) 불변 — 표시 대상 행만 축소.
- DB·EF·스키마 변경 0 (data-architect CONSULT 불요: 신규 컬럼/테이블/enum 없음).

## QA 검증
- typecheck PASS / `npm run build` PASS / E2E 7 passed (S1 라벨·식별자 / S2 진료완료 필터).
- AC5(실브라우저 렌더 — 진료완료 고객만 노출 + 진료 전 고객 제외) → supervisor 필드 QA에서 시드 데이터로 확인 요망.
