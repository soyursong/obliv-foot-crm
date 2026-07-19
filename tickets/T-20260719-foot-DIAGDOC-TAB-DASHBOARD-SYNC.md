---
id: T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC
domain: foot
priority: P1
status: deploy-ready
qa_result: pending (supervisor 실렌더 GO 대기)
deploy_commit: 15f88fcf
medical_confirm_gate: not-required
confirm_status: gate-exempt
gate_exempt_basis: "surface축=치료테이블(치료사 공간) 맨 뒤 append(§11 진료화면 게이트 비대상, 선례 signals 2026-06-30 균검사·피검사 분리표기) + 성격축=진료대시보드 [서류작성](DocRequestQueue/opinionRequest.ts 훅) read-only ADDITIVE 재노출·상속(선례 signals 2026-07-19 DOCHIST-MULTIPATH item②). planner authoritative 판정 MSG-20260719-200642-0tdt."
db_change: false
db_migration: none
db_gate: "N/A — 발행여부가 기존 발행 파이프라인 상태값 100% 매핑(신청=draft/발행완료=voided+published/미발행=draft/취소=cancelled 제외). 신규 컬럼·테이블·enum·파생 0. DA CONSULT 불요(planner 확정)."
build: pass (npm run build ✓ built in 5.99s)
scenario_count: 22 (순수로직 12 + 정적소스가드 6 + 탭배선 3 + 브라우저 현장클릭 1 — 21 static/pure PASS + 1 browser PASS)
e2e_spec: tests/e2e/T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC.spec.ts
spec: tests/e2e/T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC.spec.ts
reporter: planner (GREEN-LIGHT MSG-20260719-200642-0tdt)
branch: hotfix/T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC
created: 2026-07-19
assignee: dev-foot
summary: 치료테이블(치료사 공간) 맨 뒤에 [소견서·진단서] 탭 신설. 진료대시보드 [서류작성] 리스트를 read-only ADDITIVE 재노출 — 컬럼=환자명/요청종류(소견서·진단서)/신청시각/발행여부(발행완료·미발행). opinionRequest.ts 훅 단일 소스 재사용, 의사화면 코드 무수정, form_submissions write 0. FE-only, DB0.
---

## 배경 (planner GREEN-LIGHT)
MSG-20260719-200642-0tdt — medical_confirm_gate authoritative 판정 = **gate-exempt**. 두 독립 축(surface·성격)이
각각 gate-exempt를 지지 → 문원장 confirm 불요, 즉시 구현 착수 승인.

치료사/코디팀이 "누가 어떤 서류(소견서/진단서)를 언제 신청했고 발행됐는지"를 진료대시보드가 아닌
치료테이블에서 바로 확인하도록, 진료대시보드 [서류작성] 리스트를 치료테이블에 read-only 재노출.

## AC
- **AC-1** 발행상태 상속: 서류작성 큐 draft=`미발행`, voided+published=`발행완료`.
- **AC-2** 취소(cancelled) 제외 — 두 훅이 구조적으로 배제(draft 훅=status='draft'만, published 훅=resolved_reason='published'만).
- **AC-3** 단일 소스 강제(REDEFINITION_RISK, CHART-ORDER 좀비 교훈): DocRequestQueue 와 동일
  `useOpinionRequestQueue`/`usePublishedOpinionRequests`(opinionRequest.ts) 만 재사용. 경로별 별도조회(divergent query) 0.
- **AC-4** 경계조건(게이트 재발동 트리거 미접촉): 의사화면(DocRequestQueue/DoctorCallDashboard) 코드 미수정 +
  발행 파이프라인(form_submissions) write 0 (상태 read·표기만).
- **AC-5** 날짜이동 갱신([서류작성] 날짜필터 상속): 치료테이블 day-scoped surface 정합 — 신청시각(requested_at, KST)
  기준으로 부모 공통 date 스코프 → 날짜이동 시 자동 갱신.

## 구현
- 신규: `src/components/treatment/DiagDocSection.tsx`
  - 순수 파생: `buildDiagDocRows`(draft+published 병합·발행상태 상속) / `filterDiagDocByDate`(신청시각 KST 날짜 스코프+최신순) / `computeDiagDocSummary`.
  - read-only 훅 재사용만(직접 supabase 쿼리 0). write/rpc 0.
- 배선: `src/pages/TreatmentTable.tsx` — ⑤`소견서·진단서` 탭 맨 뒤 append + 부모 공통 `date` 상속 + 이름 인터랙션 위임.

## 검증
- `npm run build` ✓ (5.99s).
- E2E `tests/e2e/T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC.spec.ts` — 22/22 PASS
  (순수로직 12 + 정적소스가드 6 + 탭배선 3 + 브라우저 현장클릭 1).

## 한계(read-only 재사용)
`usePublishedOpinionRequests`는 당일(KST) 발행 건만 반환 → 과거일자 '발행완료'는 재구성 불가(그날 신청 후
미발행으로 남은 draft만 노출). 현장 주 사용처=당일 라이브 뷰(=진료대시보드 [서류작성] 동일 성격)로 정합.
