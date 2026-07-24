---
id: T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME
domain: foot
priority: P2
status: deploy-ready
qa_result: pending (supervisor 실렌더 GO 대기)
deploy_commit: a0c4f504
medical_confirm_gate: not-required
confirm_status: gate-exempt
gate_exempt_basis: "surface축=치료테이블(치료사 공간, /admin/treatment-table) 탭바 진열순서·라벨·중첩만 조정 — §11 진료대시보드/진료관리(의사 공간) 게이트 비대상. 선례: T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC(치료테이블=§11 비대상 planner authoritative). 진료화면 코드·데이터·발행 파이프라인 무접촉."
db_change: false
db_migration: none
db_gate: "N/A — 순수 FE presentational(탭 순서/라벨/중첩만). 신규 컬럼·테이블·enum·파생 0. 데이터 read/write 경로 무변경. DA CONSULT 불요(§S2.4 데이터 정책 게이트 비해당)."
build: pass (npm run build ✓ built in 6.07s)
scenario_count: 10 (A 진열순서 2 + B 명칭변경 2 + C 서브탭중첩 3 + 무회귀 2 + 서브탭순서 1 — 전량 정적소스가드 PASS)
e2e_spec: tests/e2e/T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME.spec.ts
spec: tests/e2e/T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME.spec.ts
reporter: planner (NEW-TASK MSG-20260724-114618-xo4e, approved)
branch: main-deploy
created: 2026-07-24
assignee: dev-foot
summary: 치료테이블 탭 진열순서 재정렬 + 명칭변경 + '경과분석 플랜' 중첩. (A) 순서 왼→오 = 진료→소견서·진단서→균검사→피검사→경과분석. (B) '진료 환자 이력' 라벨→'진료'(라벨만, key=history·컴포넌트 불변). (C) 구 top-level '경과분석 플랜'(plan) 탭을 '경과분석'(progress) 하위 서브탭으로 중첩 — 콘텐츠 미합침(부모=경과분석, 하위 2서브탭 각각 유지). value="plan"·testid=tab-progress-plans/tab-progress-targets 전량 보존. 순수 FE presentational, DB0.
---

## 배경 (planner NEW-TASK MSG-20260724-114618-xo4e)

치료테이블 탭 진열순서 재정렬 + 명칭변경 + '경과분석 플랜' 중첩. 순수 FE presentational (db_change=false, risk GO).

### 핵심 3건
- **A. 탭 진열순서(왼→오)**: 진료 → 소견서·진단서 → 균검사 → 피검사 → 경과분석
- **B. '진료 환자 이력' 라벨 → '진료'** (⚠ 라벨만 변경, 탭 식별 key·라우팅 상수·컴포넌트 유지 — 라벨↔key 혼용 금지)
- **C. '경과분석 플랜'(구 별도 최상위 탭) → '경과분석' 탭 하위 서브탭으로 중첩.** "탭은 분리하고" = 콘텐츠 합치지 말고 '경과분석'/'경과분석 플랜' 두 서브탭 각각 유지(부모=경과분석, 하위 2탭).

### 시퀀싱
목표순서의 '균검사'·'피검사'는 sibling T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST(단일탭→2탭 분리) 전제. **LABTAB-SPLIT 이미 랜딩됨**(commit 0293d932, main-deploy) → 전제 충족 확인 후 순서 적용.

## 구현 요약

- `src/pages/TreatmentTable.tsx`:
  - `SectionTab` 타입: 최상위 5탭 `'history' | 'diagdoc' | 'exam' | 'blood' | 'progress'` (구 'plan' 제거 → 서브탭 이동). 신규 `ProgressSubTab = 'targets' | 'plan'`.
  - 최상위 TabsList 트리거 순서: 진료(history) → 소견서·진단서(diagdoc) → 균검사(exam) → 피검사(blood) → 경과분석(progress, testid=tab-progress).
  - history 트리거 라벨 '진료 환자 이력' → '진료'. value/testid/컴포넌트 불변.
  - progress TabsContent 내부에 중첩 `<Tabs>` (progressSub 상태) — 서브탭 targets(경과분석=ProgressTargetsSection, testid=tab-progress-targets) / plan(경과분석 플랜=ProgressPlansTab, value="plan"·testid=tab-progress-plans).
- `tests/e2e/T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC.spec.ts`: 구 'diagdoc 맨 뒤(plan 뒤)' 순서단정을 본 티켓이 supersede → 'diagdoc이 진료 다음·검사탭 앞'으로 갱신.

## 검증

- `npm run build` ✓ (6.07s)
- 신규 spec 10 케이스 PASS + DIAGDOC-SYNC 19 PASS (합 29 passed)
- baseline 대조: PROGRESSANALYSIS-RELOCATE(52·64·74)·PROGRESSPLAN-TAB-MOVE(70) 4건 실패는 **본 변경 이전부터 sibling LABTAB-SPLIT(blood 추가)로 기존 red** — 본 티켓 유발 신규 회귀 아님.

## 금지선 준수

각 탭 콘텐츠·기능 무회귀(배치/순서/명칭/중첩만), 청구/계산/데이터 무접촉. ✓
