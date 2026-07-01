---
id: T-20260701-foot-STAFFCAL-SIDEBAR-BROWN-MONO
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 352a71cf (feat(foot): 사이드바 근무캘린더 브라운 장식톤 → 무채색 모노)
deployed_at: n/a (코드 origin/main 반영 — Vercel 자동배포·supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
e2e_spec: tests/e2e/T-20260701-foot-STAFFCAL-SIDEBAR-BROWN-MONO.spec.ts (5 시나리오 — AC1 브라운소스0 / AC3 gray치환 / AC2 의미색보존 / AC4 구조미회귀 / 렌더가드, 全 PASS)
medical_confirm_gate: n/a (CalendarNoticePanel=좌측 사이드바 달력·근무캘린더·공지 패널 / 전 화면 공통. 진료대시보드·진료관리 비대상 — §11/§11.1 게이트 무관, 순수 장식색 className 치환)
summary: "사이드바 근무캘린더(직원 달력) 컴포넌트 CalendarNoticePanel 의 브라운(갈색) 계열 장식 톤 → 무채색(그레이) 모노 치환. 순수 FE className 치환·db_change=false. 근인=tailwind.config.js 부모 THEME-MONOCHROME-RECOLOR 가 teal-* 램프를 warm-monochrome(Classic Taupe #C5BEA3 / Umber #443A35 = 브라운)으로 스윕 → 이 패널의 장식용 teal-*(text-teal-600 아이콘·bg-teal-50 명단칩·text-teal-800 등)가 실제로는 브라운/베이지로 렌더되던 것을, 미스윕 중립 팔레트 gray-* 로 치환해 유리 실버/모노 UI 와 시각 통일(AC1/AC3). 치환: text-teal-600→text-gray-500 / fill-teal-600→fill-gray-500 / text-teal-700→text-gray-600 / text-teal-800→text-gray-700 / bg-teal-100→bg-gray-100 / bg-teal-50→bg-gray-100 / border-teal-300→border-gray-300 / accent-teal-600→accent-gray-500. carve-out 보존(AC2, 미치환): 주말 요일색 red-500(일)/blue-500(토)·인수인계 완료 emerald-600·공지 삭제 red-600·handover partBadgeClass(이미 slate 모노)·선택칩 .live-glass-board(이미 실버). 직전 T-20260629-STAFFCAL-COMPACT-PASTEL(1447036a)의 컴팩트/파스텔 정비·duty-roster-section 구조 미회귀(AC4). build OK, spec 5 PASS."
created: 2026-07-01
assignee: dev-foot
owner: agent-fdd-dev-foot
---

## 요청 (planner NEW-TASK, MSG-20260701-130101-2rr2)
사이드바 **근무캘린더(직원 달력)** 컴포넌트의 브라운(갈색) 계열 색상 → 무채색(그레이/화이트/블랙) 모노톤 교체.

## 대상
`src/components/CalendarNoticePanel.tsx` — 좌측 고정 사이드 패널(미니 달력 + 근무캘린더 + 인수인계 + 공지사항). 전 화면 공통 렌더.

## 수용기준 결과
- AC1 (브라운 장식 톤 0건): PASS — 장식 teal-*(=브라운 스윕 대상) 전부 gray-* 로 치환. teal/amber/stone/brown/beige 소스 0건.
- AC2 (의미색·기능·데이터 무변경): PASS — 색 토큰/className 만 치환. 주말 red/blue·완료 emerald·삭제 red-600 보존, 데이터/조회 로직 무접촉.
- AC3 (유리 실버/모노 통일): PASS — 무채색 gray-* + 기존 실버 #C7CDD4/.live-glass-board 와 동일 톤.
- AC4 (DB/DDL 무변경, 순수 FE): PASS — db_change=false.

## REDEFINITION_RISK 대응
- 동일 surface 직전 반영분 T-20260629-STAFFCAL-COMPACT-PASTEL-DASHDUP-REMOVE(1447036a) '위에서' 브라운→무채색만 추가. 파스텔 정비·duty-roster-section 보존(AC4 회귀 스캔).
- THEME-MONOCHROME carve-out 계승: 의미색(칸반 status·emerald/green·역할칩) 및 고객용 셀프접수(.theme-brown) 비대상 — 본 건은 사이드바 근무캘린더 장식 브라운 한정.

## 후속
배포(origin/main) 후 slack thread 1782782378.915339 @C0ATE5P6JTH 안내 예정(responder 경유). supervisor QA 대기.
