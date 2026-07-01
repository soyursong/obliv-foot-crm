---
id: T-20260701-foot-DASH-SCREENSHOT-GLASS-APPLY
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: e934c5c8 (feat(foot): 대시보드 스크린샷 영역 유리 볼록+연한 실버 통일 — 결제대기 뱃지·달력 선택칩·뷰모드 활성)
deployed_at: n/a (코드 origin/main 반영 — Vercel 자동배포·supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
e2e_spec: tests/e2e/T-20260701-foot-DASH-SCREENSHOT-GLASS-APPLY.spec.ts (S1 칩·토글 유리 / S1b 결제대기 뱃지 유리(0건 graceful skip) / S2 힐러노랑 무회귀+콘솔에러0 — desktop-chrome 4 PASS)
medical_confirm_gate: n/a (대시보드 사이드바 네비 뱃지 + 달력 칩/뷰모드 버튼 = 전 직원 공용 chrome. 진료대시보드·진료관리(의사 전용) 비대상 — §11 게이트 무관, 순수 시각 CSS)
summary: "대시보드 '스크린샷' 영역(reporter 김주연 총괄 첨부 20260630_110631.png 빨간박스 = 평면 박스 카드/칩)을 앞서 컨펌된 v2 유리 볼록+연한 실버(.live-glass-board, LIVESLOT-GLASS-APPLY commit 6ff8b291)로 통일 적용. 순수 FE/CSS·db_change=false. 별도 독립 스타일 정의 X — 확정 클래스 그대로 재사용(톤/강도 재현). 대상 4칩: ① 사이드바 결제대기 뱃지(대시보드·일마감 옆, amber-500) → .live-glass-board+연한실버 border-[#C7CDD4]+text-gray-700 (AdminLayout.tsx 확장·모바일 2경로) ② 달력 선택 날짜 칩(teal-600) → 유리+연한실버+text-gray-800 ③ 뷰모드(당일/일/주/월) 활성 버튼(teal-600) → 유리+연한실버+text-gray-700 (CalendarNoticePanel.tsx). live 아님 → pulse(animate-live-border-pulse) 미적용=정적 유리(깜빡X). AC2 힐러노랑 #FFFDE7 미접촉·무채색 실버만. AC1 상단 전광판(.live-glass-board 기적용)과 동일 톤 → 통일감 확보(로컬 렌더 육안 확인). build OK. exempt=ef_only(순수 시각·동작 분기 없음). ⚠ 판단 노트: amber 결제대기 뱃지→실버 전환으로 결제대기 주의환기(색상 attention)가 약해질 수 있음 — reporter '통일감' 지시 충실 이행하되 confirm 스레드에 flag(원하면 뱃지만 amber 유지로 롤백 가능, CSS 1줄)."
created: 2026-07-01
assignee: dev-foot
owner: agent-fdd-dev-foot
---

## 요청 (planner NEW-TASK, MSG-20260701-130052-urb1)
대시보드 '스크린샷' 영역(현재 평면 박스 카드) — 컨펌 v2 유리 볼록(강)+연한 실버 테두리로 통일 적용.
reporter 원문(thread 1782782378.915339): "대시보드 스크린샷 부분도 전체 레이아웃 컨셉에 맞춰서 유리버전으로 입혀줘 통일감있게".
risk_verdict=GO(순수 CSS, 대표/DA 게이트 불요 §3.1).

## 대상 판별 (reporter 첨부 20260630_110631.png 빨간박스 4개)
슬랙 첨부 스크린샷에서 reporter가 빨간박스로 지목한 '평면 박스 카드/칩' = 아래 4개 flat-filled accent:
1. 사이드바 결제대기 뱃지(대시보드 옆 '2') — `src/components/AdminLayout.tsx`
2. 사이드바 결제대기 뱃지(일마감 옆 '2') — 동일 코드 경로
3. 달력 선택 날짜 칩('30') — `src/components/CalendarNoticePanel.tsx`
4. 뷰모드(당일/일/주/월) 활성 버튼('월') — 동일 파일
※ 형제 티켓 ②근무캘린더 모노톤·③의사 근무표 컴팩트(commit 2ae5697b, deployed)는 별개 티켓 — 본 티켓 미접촉.

## AC 이행
- **AC1** 스크린샷 영역이 슬롯/전광판과 동일 유리 볼록+연한 실버로 렌더 → 확정 `.live-glass-board`(반투명 유리 backdrop-blur+볼록 inset/outer box-shadow) + `border-[#C7CDD4]`(연한 실버) 그대로 적용. 상단 전광판(기적용)과 동일 톤. E2E S1/S1b PASS + 로컬 렌더 육안 확인.
- **AC2** 힐러 노랑 등 기존 컬러 무회귀 → 유리 클래스에 healer 노랑(#FFFDE7) 토큰 잔재 0. 대상 외 컬러 무접촉. E2E S2 PASS(healer 토큰 검사 + 콘솔에러 0).
- **AC3** DB/데이터/RLS/상태 무변경 → 순수 FE/CSS. className만 변경, 쿼리·상태·onClick 로직 무접촉. DDL 0.
- **AC4** 배포 후 번들 해시 변경 확인 + prod 실제 렌더 육안 → supervisor QA/배포 단계에서 검증(deploy 후).

## 시나리오 (E2E)
- **S1**: /admin → 달력 선택 날짜 칩·뷰모드 활성 버튼 = live-glass-board + 연한 실버, teal-600 잔재 0. → PASS
- **S1b**: /admin → 사이드바 결제대기 뱃지(있을 때) = live-glass-board + 연한 실버, amber-500 잔재 0. 0건이면 graceful skip. → PASS
- **S2**: 힐러 노랑(#FFFDE7) 무회귀 + 콘솔에러 0 + 대시보드 정상 렌더. → PASS

## 선례
T-20260701-foot-LIVESLOT-GLASS-APPLY(commit 6ff8b291) — .live-glass/.live-glass-board 유리 볼록+연한 실버 v2 확정 시안. 본 티켓은 동일 클래스를 대시보드 flat-filled 칩에 그대로 재사용(신규 스타일 X).
