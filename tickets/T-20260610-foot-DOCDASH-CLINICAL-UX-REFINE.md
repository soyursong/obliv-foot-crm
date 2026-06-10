---
id: T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE
title: "[진료대시보드] 진료완료 환자 임상경과 인라인 패널 UX 4건 (presentation)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: PENDING
created: 2026-06-10
assignee: dev-foot
reporter: 문지은 대표원장(U0ALGAAAJAV)
source_msg: MSG-20260610-155125-6fej
needs_field_confirm: true
confirm_thread: "1781073127.932639"
related_tickets:
  - T-20260609-foot-DOCDASH-CHART-UX
  - T-20260608-foot-MEDCHART-SIGN-AUDIT
---

# T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE

## 요청 (planner NEW-TASK)
진료완료 환자 임상경과 인라인 패널(MedicalChartPanel embed clinicalMiniBody) UX 정제 4건.
전건 presentation / db_change=false. 파일: `src/components/MedicalChartPanel.tsx`.

## AC
- **AC-1**: clinicalMiniBody 컨텍스트 안내 `<p data-testid="clinical-mini-context">` 3 variant 모두 제거.
- **AC-2**: '· 진료기록 필수 (의료법)' 라벨 span 양쪽(embed clinicalMiniBody + 풀차트
  signing-doctor-select-block) 제거. **로직=A안 선배포**: 진료의 필수검증 유지, 라벨 텍스트만 제거.
  ⚠️GUARD: 진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6, 의료법) 검증 절대 제거 금지 — 보존 확인.
  (B안 embed auto-fill 은 reporter 답변 후 TICKET-UPDATE 로 추가 예정)
- **AC-3**: clinicalMiniBody Textarea embed `rows 3→5`, `min-h-[4.5rem]→min-h-[8rem]`. embed=false 풀차트(14/18rem) 불변.
- **AC-4**: 담당의 label+select 1줄 인라인(flex items-center gap-2, label w-16 고정 + select flex-1).
  "진료의를 선택해야 저장할 수 있습니다." 경고 p는 A안이므로 유지.

## 구현 노트
- 단일 파일 `src/components/MedicalChartPanel.tsx` 4개 지점 수정. presentation-only.
- AC-2 GUARD: `handleSave` 의 `if (!formSigningDoctorId)` 차단(AC-P2-6) 무변경 — spec 으로 회귀 가드.
- REDEFINITION_RISK: 同 surface DOCDASH-CHART-UX 인라인 아코디언 구조 위 비파괴 적층.

## 검증
- build OK (vite, 3.75s)
- unit spec 10/10 pass — `tests/e2e/T-20260610-foot-DOCDASH-CLINICAL-UX-REFINE.spec.ts`
- **실브라우저 검증(presentation 필수)**: 진료 대시보드 → 진료 완료 환자 → '임상경과' 인라인 패널 렌더 확인.
  - AC-1 context p 부재 ✓ / AC-2 의료법 라벨 부재 + 경고 p 보존 ✓ / AC-3 textarea 확대 ✓ / AC-4 담당의 1줄 인라인 ✓
  - 풀차트(서랍) surface 도 의료법 라벨 부재 + 경고 보존 실브라우저 확인.

## 현장 confirm
- reporter=문지은 대표원장 / confirm thread=1781073127.932639
