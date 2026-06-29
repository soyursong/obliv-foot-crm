---
id: T-20260629-foot-ASSIGN-ALERT-MARQUEE
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 1ea43b950939
deployed_at: 2026-06-29T20:17:12+09:00
bundle_hash: Bjk2pnj9
summary: "담당자 배정 알림 위치 이동 + 전광판 강조(김주연 총괄, #풋): (1) AssignmentNotifyBell를 헤더 우측 끝 → 좌측 지점명+날짜 선택 바로 옆으로 이동(AC-1, 패널 anchor right-0→left-0). (2) 미읽음 배정 알림이 있을 때만(AC-3) 전광판(마키) 스트립 노출 — 배정 내역(고객명→담당자명)이 좌우로 흐르고 테두리 글로우. 순수 CSS animation(tailwind keyframes marquee 12s linear + alert-glow 1.6s), 신규 npm 패키지 0(AC-2). prefers-reduced-motion 환경엔 motion-safe:* 미적용 + motion-reduce:truncate로 정적 amber 강조 폴백. (3) 좁은 폭 max-w 단계(150/260/360px·overflow-hidden)로 헤더 무붕괴, 날짜 선택(이전/다음/오늘로) 무회귀(AC-4). 알림 노출 조건·내용은 기존과 동일(컴포넌트 로직 불변, 배치+전광판 래퍼만 추가). DB 변경 없음. 빌드 OK, E2E 5 PASS(S1 좌측배치·S2 전광판노출·S2b 모두읽음시 사라짐·S3 무회귀+좁은폭), staff-assignment·kanban-drag 회귀 0."
created: 2026-06-29
assignee: dev-foot
db_change: false
e2e_spec_exempt_reason: n/a
---

# T-20260629-foot-ASSIGN-ALERT-MARQUEE — 담당자 배정 알림 이동 + 전광판 강조

## 배경
김주연 총괄(#풋): 담당자 배정 알림(헤더 우측 끝 종 아이콘)이 시선에 안 들어와 놓침 →
(1) 위치(지점)+날짜 선택 UI **바로 옆**으로 이동, (2) 전광판처럼 시선 끄는 강조.

## 구현
- **`AdminLayout.tsx`**: `<AssignmentNotifyBell>`를 헤더 우측 컨트롤 그룹 → 좌측 그룹
  (지점명 + 날짜 `today` 바로 옆)으로 이동(AC-1). 우측 그룹에선 제거.
- **`AssignmentNotifyBell.tsx`**:
  - 래퍼 `flex items-center gap-1.5`로 [전광판 스트립][종] 가로 배치. 드롭다운 패널 anchor
    `right-0 → left-0`(좌측 이동에 맞춤). 종/패널/읽음 로직·노출 조건·내용 **불변**.
  - `unreadCount > 0`일 때만(AC-3, 상시 점멸 금지) 전광판 스트립(`data-testid=assign-notify-marquee`)
    노출. 텍스트 = `담당자 배정 알림 N건 · {고객명} → {담당자명} 배정 · …`(미읽음 내역).
  - 전광판 강조(AC-2): 텍스트 2벌 복제 후 `animate-marquee`(translateX 0→-50%, 12s linear)
    좌측 흐름 + `animate-alert-glow`(테두리 글로우) + 확성기 아이콘 `pulse-hand`.
    **순수 CSS(tailwind keyframes)** — 신규 npm 패키지 0.
  - `prefers-reduced-motion`: `motion-safe:animate-*`로 흐름/글로우 미적용 + `motion-reduce:truncate`
    + 복제본 `motion-reduce:hidden` → 정적 amber 강조 폴백.
  - 좁은 폭(AC-4): `max-w-[150px] sm:max-w-[260px] md:max-w-[360px]` + `overflow-hidden`로
    헤더 가로 붕괴 방지.
- **`tailwind.config.js`**: keyframes `marquee`, `alert-glow` + animation 매핑 추가.

## 가드 (준수)
- **DB 스키마 변경 없이 FE만** — 신규 컬럼/테이블/enum 0. data-architect CONSULT 불요.
- **신규 npm 패키지 0** — tailwind 자체 keyframes만 사용(AC-2 명시).
- **알림 노출 조건·내용 동일** — fetch/읽음/패널 로직 불변, 배치 + 전광판 래퍼만 추가(AC-1).
- 진료대시보드/진료관리(의료화면) 무관 — 전역 헤더·자동배정 알림(직원 동선)만 수정.

## 현장클릭시나리오 / E2E
tests/e2e/T-20260629-foot-ASSIGN-ALERT-MARQUEE.spec.ts (5 passed)
- S1(AC-1): 종이 헤더 좌측(지점명+날짜) 옆 — 우측 검색보다 왼쪽·우측끝 미부착 + 클릭 시 동일 패널
- S2(AC-2/AC-1): 미읽음 있을 때 전광판 스트립 노출(머리말+고객명+배정) + 클릭 시 패널 토글
- S2b(AC-3): 모두 읽음 → 전광판/배지 사라짐(상시 점멸로 화면 점령 금지)
- S3(AC-4): 날짜 선택(이전/다음/오늘로) 무회귀 + 820px 좁은 폭 헤더 무붕괴(뷰포트 내)

## 후속 (FOLLOWUP 후보, 본 티켓 범위 외)
- `staff` 테이블에 `display_name` 컬럼이 없어 기존 컴포넌트의 staff 이름 매핑이 항상 '담당자'로
  폴백됨(배정 알림에 실제 담당자명 대신 '담당자' 표시). 본 티켓 AC("내용 동일 유지")상 미수정 —
  실명 노출이 필요하면 별도 티켓 권장(`staff.select('id, name')`로 정정).
