---
id: T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: tests/e2e/T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN.spec.ts
medical_confirm_gate: required
confirm_status: confirmed
summary: "진료대시보드 '서류작성' 탭 '서류 완료' 목록에서 어제 발행된 소견서/진단서가 자정을 넘기면 사라지던 결함(track2 (b) 발행완료 day-scope) 수정. RC(dev audit e93j/y9q3=BRANCH A): usePublishedOpinionRequests(opinionRequest.ts)가 resolved_at KST==today 로 '당일 발행'만 반환 → 날짜선택기 없는 당일 surface(진료대시보드)에서 어제 발행분이 자정 교차 시 완료목록 소실(form_submissions row 전량 생존, 조회 스코프 문제일 뿐). FIX(FE-only, 치료테이블 07-26 선례 T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND(7469eb9e) 동형): DocRequestQueue '서류 완료' 소스를 day-scoped→all-time(useAllPublishedOpinionRequests, main 기존 훅 재사용)로 전환, 날짜 스코프는 소비 컴포넌트가 순수함수 selectDashboardCompletedRows 로 '전체기간' 결정(진료대시보드=날짜선택기 부재 surface). = 화면 표시 범위만 확장(비파괴). 매핑은 day-scoped·all-time 두 훅이 동일 mapPublishedRequestRow 공유(drift 0). 미발행(draft) 큐 useOpinionRequestQueue 무접촉·무회귀."
created: 2026-07-28
reporter: planner
risk_verdict: GO
risk_reason: "§11 의사공간 게이트 CLEARED (MSG-20260728-201914-azuv, 김주연 총괄): 문지은 대표원장 confirm(ts 1785233510) + reporter 김주연 confirm(ts 1785233635) → status blocked→approved. 본 티켓이 07-26 선례가 §11.1 목적으로 의도적 미변경했던 진료대시보드(DocRequestQueue) surface 를 확장하는 것이 목표(원장 confirm 으로 게이트 해소). 치료테이블(DiagDocSection) 재작업 없음. db_change=false 확정(dev audit BRANCH A: form_submissions row 전량 생존, read-only 조회 스코프만 확장, DDL/DML 0 — rows-affected 검증 불요). all-time 훅(useAllPublishedOpinionRequests)은 form_submissions SELECT only(insert/update/delete/upsert/rpc 0, spec B-3 가드). da_consult 불요(신규 컬럼·테이블·enum·RLS 0, 기존 필드 read-only 재사용). 회귀: (a) 오늘 선택 무회귀=all-time 은 day-scoped 의 superset(오늘 발행분 온전 노출) (b) 미발행 draft 큐 useOpinionRequestQueue=날짜필터 원래 부재→무접촉 (c) cancelled 9건 완료뷰 구조적 제외 유지(all-time 훅 resolved_reason='published' 필터). 신규 E2E spec 9/9 PASS(--project=unit) + npm run build(tsc+vite) PASS. 07-26 spec 의 dashboard day-scoped 불변식(supersede) 1건 갱신. 스코프 튜닝 여지: selectDashboardCompletedRows 단일 함수에 스코프 국소화 → 향후 원장이 all-time 이 과다하다 판단 시 rolling window(예 14d)로 최소 변경 가능."
commit: c3606559
deploy_commit: c3606559
bundle_hash: index-95HqmjAK.js
deploy_ready_at: 2026-07-29T00:52:25+09:00
supersedes_invariant: "T-20260726-foot-TREATTABLE-PUBDOC-DATESCOPE-EXPAND.spec.ts — DocRequestQueue day-scoped 유지 가드(§11 게이트 해소로 대시보드 all-time 확장)"
remark_note: "FIX-REQUEST MSG-20260728-233921-afan (stale_branch_merge_conflict) 해소 — branch 를 origin/main@2e2f9f2b(재-QA 시점 HEAD, FIX-REQUEST 기준 745a6c7f 의 후속) 위로 rebase. playwright.config.ts 충돌 재해소(ATTENDINGDR + DOCWRITE spec 등록 testMatch·testIgnore 각 1쌍 양쪽 보존). DocRequestQueue.tsx = ATTENDINGDR(진료의 명의/도장/차트 rework) 위에 완료행 소스 교체(selectDashboardCompletedRows) auto-merge 정합 확인(의존 훅 useAllPublishedOpinionRequests·mapPublishedRequestRow·OpinionRequestRow.resolvedAt·doneDocLabel 전부 병합 트리 유효). 병합 트리 재빌드 GREEN(tsc+vite) + E2E 9/9 재-PASS(--project=unit) + 회귀 ATTENDINGDR·TREATTABLE 20/20 PASS. 3필드 fresh 갱신(deploy_commit=c3606559 신규 rebase 커밋, bundle_hash=index-95HqmjAK.js, deploy_ready_at 재마킹) + qa_result clear. db_change=false·§11 게이트 CLEARED 유효."
---

# T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN

## 증상 (현장, 김주연 총괄 blocking)
진료대시보드 **서류작성 탭 → '서류 완료' 목록**에서, 어제 발행한 소견서/진단서가 **자정을 넘기면 사라진다**. (재진입해도 완료목록에 안 보임.)

## RC (dev audit e93j/y9q3 = BRANCH A, service_role READ-ONLY)
- `usePublishedOpinionRequests`(opinionRequest.ts)는 `resolved_at` KST==today 로 **'당일 발행'만** 반환(2일 lookback 은 자정 교차 발행 포섭용일 뿐, 최종 필터는 오늘).
- 진료대시보드(DoctorCallDashboard/DoctorTools)는 **날짜선택기가 없는 당일 surface** → 어제 발행분이 자정 교차 시 완료목록에서 소실.
- **row 물리 소실 아님**: `form_submissions` 발행완료 row(voided + `field_data.resolved_reason='published'`) 전량 생존. 순수 **조회 스코프** 문제(BRANCH A). DDL/DML 불요.

## FIX (FE-only, db_change=false — 치료테이블 07-26 선례 동형)
`src/components/doctor/DocRequestQueue.tsx`:
- ① 발행완료 소스 `usePublishedOpinionRequests`(day-scoped) → **`useAllPublishedOpinionRequests`(all-time, main 기존 훅 재사용)** 로 전환.
- ② 신규 순수함수 `selectDashboardCompletedRows(allPublished)` 도입 — 진료대시보드는 날짜선택기 없는 당일 surface 이므로 날짜 스코프를 **'전체기간'** 으로 결정(발행 시각 resolvedAt desc 방어적 재정렬). 스코프 결정을 소비 컴포넌트로 국소화 → 향후 튜닝(예 rolling window) 최소 변경 지점.
- ③ 매핑은 day-scoped·all-time 두 훅이 **동일 `mapPublishedRequestRow` 공유**(drift 0).
- **day-scoped 훅은 삭제하지 않고 유지**(opinionRequest.ts 무변경 — §11 의료로직·다른 surface·이력 재사용 여지 온존).

`tests/e2e/T-20260726-...-EXPAND.spec.ts`: 07-26 당시 'DocRequestQueue day-scoped 유지' 불변식은 §11 게이트 해소로 본 티켓이 supersede → 해당 가드 1건을 'dashboard 도 all-time 소비'로 갱신(치료테이블 확장 자체는 불변 유지).

## AC
- [x] 어제/과거 발행완료 소견서·진단서가 자정 이후에도 '서류 완료' 목록에 잔류 (all-time)
- [x] 오늘 발행분 무회귀 (all-time = day-scoped superset — 오늘 선택 동작 온전)
- [x] 발행 0건 시 완료목록 빈 상태(오노출/크래시 없음)
- [x] 미발행(draft) 큐 무접촉·무회귀 (useOpinionRequestQueue 날짜필터 원래 부재)
- [x] cancelled 완료뷰 구조적 제외 유지 (all-time 훅 resolved_reason='published' 필터)
- [x] db_change=false (DDL/DML 0, read-only 조회 스코프만 확장)
- [x] 신규 E2E spec 9/9 PASS (--project=unit) + npm run build PASS

## 게이트
- **§11 의사공간(진료대시보드)**: `medical_confirm_gate: required` / `confirm_status: confirmed` — 문지은 대표원장 confirm 완료(MSG-20260728-201914-azuv).
- **da_consult**: 불요 (신규 컬럼·테이블·enum·RLS 0, 기존 필드 read-only 재사용).

## 현장 안내
QA GO + 배포 반영(pages.dev version.json HEAD 일치) 후에만 responder 경유 발송. 반영 전 통보 금지.
