---
id: T-20260630-foot-RESV-LEFTPANEL-SCROLL-CLIP
domain: foot
priority: P2
status: deploy-ready
qa_result: pending (supervisor E2E 대기)
deploy_commit: b82ecc6d
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "예약관리 좌측 사이드 패널(달력+근무캘린더+인수인계+공지사항)에 패널 내부 단일 스크롤(overflow-y-auto) 적용 → 인수인계 항목이 많아 패널 높이를 넘어도 하단까지 스크롤로 전부 도달(클리핑 해소). 원인=근무캘린더/인수인계 섹션이 shrink-0라 합산 높이가 aside(overflow-hidden)를 초과 시 공지영역(flex-1 min-h-0)이 0으로 눌리고 상단 섹션이 잘림. 수정=CalendarNoticePanel 패널 헤더 아래 콘텐츠 전체를 flex-1 min-h-0 overflow-y-auto 단일 스크롤 영역(data-testid=panel-scroll-area)으로 감싸고, 공지영역의 독립 스크롤(flex-1+내부 overflow-y-auto) 제거 → 패널 단일 스크롤로 흡수. 순수 레이아웃(Tailwind 클래스만), 데이터/조회 로직 미접촉, DB 무변경. NOTICE-SCROLL(T-20260512) 저장/취소 버튼은 패널 스크롤 scrollIntoView로 도달 보존. build OK(5.14s)."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260630-foot-RESV-LEFTPANEL-SCROLL-CLIP.spec.ts
medical_confirm_gate: n/a (예약관리 좌측 패널 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장 — planner NEW-TASK MSG-20260630-193301-eq4d)

예약관리 화면 왼쪽 사이드 패널(달력 + 근무캘린더 + 인수인계 전체)에 overflow-y 스크롤이
없어, 인수인계 항목이 많으면 패널 높이를 넘는 하단 항목이 잘려 안 보임. 패널 컨테이너에
overflow-y:auto + 높이 제약을 적용해 패널 내부 스크롤로 전부 보이게.
첨부 스크린샷: ~/file_inbox/20260630/192644_F0BE6FFKPRP_20260630_192532.png (빨간 박스=대상 패널)

## AC

- AC1: 좌측 패널 컨테이너 overflow-y-auto + 높이 제약(flex-1 min-h-0). → panel-scroll-area
- AC2: 인수인계 여러 건이어도 맨 아래까지 스크롤로 확인(클리핑 해소).
- AC3: 데이터·조회 로직 무변경(순수 스크롤/레이아웃).
- AC4: 항목 적을 때 불필요 스크롤바 X(auto), 중앙/우측 영역 회귀 없음.

## 구현 노트

flex column에서 자식(근무/인수인계)이 shrink-0라 안 줄어 스크롤이 안 먹던 전형.
부모 min-h-0/h-full 체인을 패널 헤더 아래 단일 스크롤 래퍼로 정리. 형제 패턴
ASSIGNMONTHLY-SCROLL-REMOVE / CLOSING-INPROG-PAYWAIT-MAXH-SCROLL 재사용.

변경 파일:
- src/components/CalendarNoticePanel.tsx (헤더 아래 콘텐츠 단일 스크롤 래퍼, 공지영역 독립 스크롤 제거)
- tests/e2e/T-20260630-foot-RESV-LEFTPANEL-SCROLL-CLIP.spec.ts (신규, 4 AC)

commit: b82ecc6d
