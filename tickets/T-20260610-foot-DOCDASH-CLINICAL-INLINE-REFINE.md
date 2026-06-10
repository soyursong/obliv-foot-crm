---
id: T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE
title: "[진료대시보드] 임상경과 인라인 패널 2차 정제 4건 (presentation)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 7195e5b
created: 2026-06-10
assignee: dev-foot
reporter: 문지은 대표원장(C0ATE5P6JTH)
source_msg: MSG-20260610-154927-vomm
needs_field_confirm: true
confirm_thread: "1781073127.932639"
related_tickets:
  - T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE
  - T-20260609-foot-DOCDASH-CHART-UX
  - T-20260608-foot-MEDCHART-SIGN-AUDIT
---

# T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE

## 요청 (planner NEW-TASK)
진료대시보드 임상경과 인라인 패널(MedicalChartPanel `variant='clinical'` embed clinicalMiniBody) 2차 다듬기 4건.
전건 presentation / db_change=false. 파일: `src/components/MedicalChartPanel.tsx` (호출: `src/components/doctor/DoctorCallDashboard.tsx`).
prior `DOCDASH-CLINICAL-UX-REFINE`(field-soak 7374754) 위 refinement.

## AC & 처리 결과
- **AC-1** 패널 상단 "오늘 새 임상경과를 작성합니다." 안내문구 제거
  → **이미 완료**(prior REFINE AC-1 가 `clinical-mini-context <p>` 3 variant 전부 제거). 현 HEAD src+dist 에 잔존 0 — 회귀가드만 추가.
- **AC-2** 임상경과 텍스트 입력 필수 validation 제거(선택 입력화)
  → ⚠️GUARD 코드 확인 결과: **(a) 임상경과 텍스트 required validation 은 애초에 부재** (`clinical_progress: formClinical.trim() || null`, 저장버튼 disabled=`saving||!formDate`, handleSave 에 clinical 검사 없음 → 이미 선택입력). **(b) 진료의 NOT NULL 강제**(AC-P2-6, 의료법, `if (!formSigningDoctorId)`)만 존재 → 절대 미변경. (a)/(b) 미결합이라 임의판단 불필요, (b) 보존 확인 spec.
- **AC-3** 임상경과 textarea 추가 확대 → embed `rows 5→9`, `min-h-[8rem]→min-h-[14rem]`, `w-full` 명시. 풀차트(embed=false) 14/18rem 불변.
- **AC-4** 담당의 선택칸 + 인접(label) 동일 행 컴팩트 + 좁은폭 wrap 허용 → 담당의 행 래퍼 `flex items-center gap-2`에 `flex-wrap` 추가(이미 prior REFINE 으로 label+select 1줄 인라인).
- **AC-5(guard)** DB/저장로직 무변경, 인라인 동선(AC1-1) 회귀 금지 → 충족(presentation-only, embed-gated, drawer/풀차트 불변).

## 구현 노트
- 단일 파일 `src/components/MedicalChartPanel.tsx`, clinicalMiniBody 2개 지점(담당의 행 flex-wrap / textarea 확대) + 주석.
- AC-1·AC-2 는 prior REFINE 산출물 위라 신규 코드변경 없음 → spec 회귀가드(잔존 0 + (b) 보존)로 커버.
- needs_field_confirm: AC-1/AC-2 가 prior REFINE 로 선반영됐음을 문지은 대표원장이 새 deploy 에서 확인 필요.

## 검증
- build OK (vite)
- unit spec pass — `tests/e2e/T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE.spec.ts`
- 실브라우저(presentation): 진료대시보드 → 활성콜/진료완료 행 '임상경과' 인라인 펼침 →
  상단 안내문구 부재 ✓ / 임상경과 빈 채 + 담당의 선택 시 저장 가능 ✓ / 담당의 미선택 저장 차단 ✓ / textarea 확대 ✓ / 담당의 1줄 컴팩트 ✓

## 현장 confirm
- reporter=문지은 대표원장 / confirm thread=1781073127.932639 (C0ATE5P6JTH)
