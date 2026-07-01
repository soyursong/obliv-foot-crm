---
id: T-20260701-foot-DOCROSTER-COLWIDTH-COMPACT
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 2ae5697b (feat(foot): 의사 근무표 칸 너비 컴팩트화 — 내용기준 auto-width)
deployed_at: n/a (코드 origin/main 반영 — Vercel 자동배포·supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
e2e_spec: tests/e2e/T-20260701-foot-DOCROSTER-COLWIDTH-COMPACT.spec.ts (3 시나리오 — 원장 데이터 有 실행분 PASS, 원장 0명 graceful skip)
medical_confirm_gate: n/a (의사 근무표=DutyRosterTab 직원 근무 스케줄 그리드 / admin·manager 편집. 진료대시보드·진료관리 비대상 — §11 게이트 무관, 순수 레이아웃 CSS)
summary: "사이드바 의사 근무표(DutyRosterTab, 원장×날짜 주간 그리드) 각 칸(셀) 너비를 내용 기준으로 컴팩트화. 순수 FE CSS(레이아웃만)·db_change=false. 핵심 레버=table `w-full` 제거 → 내용 기반 auto-width(6열+이름열이 넓은 컨테이너 폭에 균등분산돼 셀이 넓어지던 것 해소, AC1). 부가: 원장님 컬럼 고정폭 w-28 제거+whitespace-nowrap, th/td 좌우여백 px-3/px-2→px-1.5·세로여백 py-2.5/py-2→py-1.5/py-1·날짜셀 p-1→p-0.5(선례 T-20260613-CLINIC3-TABLEDENSITY-TIGHTEN KohReportTab 밀도규칙 동형). 날짜 버튼 h-10 유지(태블릿 탭 타깃)+min-w-[3rem] 과축소 방지. AC2 넘침0=whitespace-nowrap 유지+scrollWidth<=clientWidth 검증. AC3 회귀0=표시내용·데이터·토글(3단 nextRosterType)·전주복사·import 로직 무접촉. E2E 시나리오1(auto-width<container·원장님컬럼<112px) 첫 실행 그리드 렌더 시 PASS, 시나리오3(배너·빈상태 정상렌더) PASS, 원장 0명 환경은 DUTYROSTER 선례 동일 DB-비오염 정책으로 graceful skip. build OK."
created: 2026-07-01
assignee: dev-foot
owner: agent-fdd-dev-foot
---

## 요청 (planner NEW-TASK, MSG-20260701-125959-4zdx)
사이드바 **의사 근무표** 컴포넌트 각 칸(셀) 너비 컴팩트화 — 좌우 padding/min-width/열 폭 축소.
표시 내용·데이터·정렬/필터 로직 무변경(레이아웃만). risk=GO(순수 FE CSS).

## 대상
`src/components/DutyRosterTab.tsx` — /admin/handover 상단 "의사 근무표" 섹션(원장×날짜 주간 근무 그리드).

## AC 이행
- **AC1** 각 칸 너비 컴팩트(내용 기준 타이트): table `w-full` 제거(auto-width) + w-28 고정폭 제거 + 셀 좌우여백 축소. → E2E S1 PASS(table 실측폭 < 컨테이너폭, 원장님 컬럼 < 옛 112px).
- **AC2** 글자 넘침·잘림 0: whitespace-nowrap 유지 + 셀 scrollWidth<=clientWidth. → E2E S2.
- **AC3** 표시내용·데이터·정렬/토글 무변경(레이아웃 외 회귀 0): 데이터 쿼리·셀 토글·전주복사·import 코드 무접촉. → E2E S3 PASS(배너·그리드 정상 렌더).

## 선례
T-20260613-foot-CLINIC3-TABLEDENSITY-TIGHTEN(commit ab761173) — KohReportTab 테이블 밀도 규칙(px-1.5 py-1 + whitespace-nowrap) 동형 적용 + 본 그리드 특성(w-full 균등분산)에 맞춰 auto-width 전환 추가.
