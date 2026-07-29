---
id: T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE
domain: foot
priority: P2
status: deployed
qa_result: pass
qa_grade: Green
deploy_commit: c251645a1d1a
commit: f58a0106df343309ad943a6a6f390392501d5d69
deployed_at: 2026-07-30 01:32:31 +09:00
bundle_hash: index-Dm4HobMA.js (CF version.json commit=f58a0106df34, builtAt 2026-07-29T16:32:31Z)
qa_verified_by: supervisor
qa_verified_at: 2026-07-30 01:34 +09:00
qa_notes: "GO/Green. 이미 origin/main 반영(c251645a fix + f58a0106 docs)·CF auto-deploy 완료(live bundle 'cancelled' guard 확인). Phase1 build OK / Phase1.5 env matrix(신규 env 0) / Phase2 browser baseline BROWSER OK(3|0) / runtime-safety clean / DA HOLD CLEAR / db_change=false·RED LINE(assigned_consultant_id) 무접촉→Contract Gate·DA CONSULT 비해당. dayAssignCounts 집계에 .neq('status','cancelled') 추가로 3번째 surface 불변식 일관화(staffStats a7885a99·이력표 8ff93685 계보). 현장알림 skip: dev-internal 관찰 스핀아웃·reporter_slack_id null·slack_thread_ts null·admin전용 카운트 정확도(현장 동선/중복표시 무영향)."
db_change: false
db_migration: none
db_gate: N/A — FE 표시/집계 레이어 전용. 신규 컬럼·테이블·enum 0. 기존 check_ins.status 조회 컬럼(select 재사용) 에 서버필터 .neq('status','cancelled') 추가만. §S2.4 데이터 정책 자문 게이트 비해당.
build: pass (npm run build ✓)
scenario_count: 6 test PASS (S1 F-5247 재배정 정합 / S2 과다→정상 델타 / S3 엣지 deleted·cancelled·null / STATIC 소스구조 / REGRESS 인접 surface 불변식) + 인접 랭킹 회귀 16 PASS
e2e_spec: tests/e2e/T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE.spec.ts
spec: tests/e2e/T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE.spec.ts
related_fix: 8ff93685 (금일 배분 이력 표 cancelled 가드) / a7885a99 (staffStats 누적·드릴 팝업 cancelled 가드) — 동일 불변식 계보
red_line_touched: false (customers.assigned_consultant_id / 배정 규칙 무접촉 — 집계 필터만)
created: 2026-07-29
completed: 2026-07-30
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (MSG-20260729-180611-gwwe) — F-5247 스코프-밖 관찰 스핀아웃
---

# T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE — [랭킹] 탭 당일 배정건수 cancelled 배제

## 착수 근거
planner NEW-TASK MSG-20260729-180611-gwwe (approved, P2). F-5247(장홍석 중복배정) 처리 중
dev-foot 가 관찰한 scope-밖 이슈 = "[랭킹] 탭 '당일 배정건수' 집계가 cancelled 포함 → 과다카운트"
를 planner 가 스핀아웃 P2 로 승인.

## 문제
[랭킹] 탭 #6 당일 배정건수(`dayAssignCounts`) 서버 집계 쿼리가 `check_ins` 를
`deleted_at IS NULL` + `consultant_id IS NOT NULL` + 당일 구간 만 필터하고 `status='cancelled'`
를 배제하지 않아, 취소된(비-soft-hide) 배정이 유령으로 잔존해 배정건수가 과다카운트됨.

## 불변식 계보 (F-5247)
- `staffStats`(누적/드릴 팝업, a7885a99) — cancelled 배제 가드 적용됨.
- 금일 배분 이력 표(8ff93685) — 동일 가드 적용됨(잔여면 델타).
- 두 surface 에서 확립한 불변식 = **"취소(cancelled) 배정은 배정 카운트/표시에서 배제 — done 등 활성 배정만 집계"**.
- 본 티켓 = 동일 불변식을 [랭킹] 탭 당일 배정건수 집계에도 일관 적용(잔여 3번째 surface).

## 변경
`src/pages/Assignments.tsx` — [랭킹] 탭 6-read 병렬 중 당일 배정건수 쿼리(check_ins)에
`.neq('status', 'cancelled')` 추가. done 등 활성 배정만 집계.

- 배정 규칙/`customers.assigned_consultant_id` 무변경 (RED LINE 무접촉).
- 집계 필터만 변경. `db_change=false`.
- 주석에 staffStats·이력 표 불변식 계보 명시.

## 검증
- E2E spec 6 PASS: S1(F-5247 재배정 정합 — cancelled 실장 0, done+활성 유지) /
  S2(과다→정상 델타 — 유령 배정 제거) / S3(엣지 deleted·cancelled·null 모두 배제) /
  STATIC(소스구조 — .neq cancelled 존재 + 기존 가드 유지) / REGRESS(인접 surface 불변식 잔존).
- 인접 랭킹 회귀 16 PASS: RANKING-TAB-DATEPICKER-6SPEC / CRM-ASSIGN-RANKING-TAB-ADMINLOCK (렌더 파손 없음).
- npm run build ✓.

## 배포
ticket branch `T-20260729-foot-RANKING-DAYASSIGN-COUNT-CANCELLED-EXCLUDE` push → supervisor QA → origin/main merge → CF Pages 자동배포.
