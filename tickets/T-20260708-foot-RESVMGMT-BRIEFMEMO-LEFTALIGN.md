---
id: T-20260708-foot-RESVMGMT-BRIEFMEMO-LEFTALIGN
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: ac1fa644
deployed_at: 2026-07-08 (main merge 완료 — Vercel 자동배포)
db_change: false
db_migration: none
db_gate: N/A
build: pass
scenario_count: 8
spec: tests/e2e/T-20260708-foot-RESVMGMT-BRIEFMEMO-LEFTALIGN.spec.ts
bundle_hash: n/a (FE CSS 정렬만 — Reservations.tsx renderDayCard)
created: 2026-07-08
completed: 2026-07-08
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: 김주연 총괄 (U0ATDB587PV)
slack_channel: C0ATE5P6JTH
ui_screenshot_gate: not_applicable
summary: "예약관리 달력 격자 고객박스 [간략메모] 칩 정렬 정정(중앙→좌측, 고객 이름 바로 밑). 旣요청 누락 완결. RC(코드확정)=부모 격자 컨테이너(resv-day-xaxis)가 className grid text-center 라, 성함 아래 간략메모 block <div>(resv-day-brief)가 중앙정렬로 '상속'됨. 성함은 flex 행(items-center, justify default=flex-start)이라 좌측인데 메모만 중앙 → 성함 좌측 기준선과 어긋난 게 스샷 F0BFNLT8D0T 현상. FIX=간략메모 block <div> + 힐러 pkgtype fallback block <div>(同 메모 슬롯)에 text-left 명시 → text-center 상속 override, 성함 좌측 기준선 정렬. 중앙정렬 흔적 제거. 칩 미선택 예약은 조건부 렌더(brief_note truthy 시에만)로 빈 영역 잔류 0(기존 동작 불변). 표시 소스(r.brief_note.trim())·저장경로(reservations.brief_note) 무변경 — 정렬만. DoD#1(부모 CUSTBOX-PADDING-MEMO-POS②/OVERHAUL AC5-2 무모순): 박스 세로순서 = 이름 → 간략메모(좌측) → 예약상태/기타 유지. DoD#2(자매건 NEWRESV-MEMOBOX-BELOWNAME): 격자 고객박스는 renderDayCard 인라인 JSX, 신규예약 생성모달 박스는 별도 컴포넌트 → 컴포넌트/CSS 미공유(분리) → 각각 처리(본 티켓=격자만). DoD#3(스샷 게이트): 앵커 단일(resv-day-brief-{id}, RC=text-center 상속) 모호성 0 → 좌표추측/FOLLOWUP 불요. FE-only, DB/스키마/마이그/RLS 변경 0. 검증: build PASS / 티켓 E2E 8 PASS / 회귀(CUSTBOX-PADDING-MEMO-POS 7 — text-left 반영 갱신 후) PASS. 실 렌더 좌측정렬 육안 confirm 은 supervisor field-soak(갤탭 실기기)로 종결."
---

# T-20260708-foot-RESVMGMT-BRIEFMEMO-LEFTALIGN

원천: 旣요청 누락 완결. 증거 스샷 F0BFNLT8D0T (20260708_113019.png — 중앙정렬 현상태).

## 핵심 AC
- 격자 고객박스 중앙정렬 [간략메모] 칩 → 좌측정렬 + 고객 이름 바로 아래(이름과 좌측 기준선 정렬). 중앙정렬 흔적 제거.
- 칩 미선택 예약은 이름만(빈 영역 잔류 금지).
- 표시 소스·저장경로 무변경. 정렬만.

## 구현 (commit ac1fa644)
- `src/pages/Reservations.tsx` renderDayCard:
  - 간략메모 block `<div>` (resv-day-brief) className 에 `text-left` 추가 → 부모 `text-center` 상속 override.
  - 힐러 pkgtype fallback block `<div>` (resv-day-pkgtype, 同 메모 슬롯) 도 `text-left` 통일.
- RC: 격자 컨테이너 `grid text-center` 상속으로 block div가 중앙정렬 / 성함 flex 행은 좌측 → 어긋남.

## DoD
1. 부모 CUSTBOX-PADDING-MEMO-POS②(성함→메모 순서)·OVERHAUL AC5-2 무모순 — 세로순서 [이름→간략메모(좌측)→상태] 유지. 격자 이미 shipping(main) → 독립 정밀화(churn 없음).
2. 자매건 NEWRESV-MEMOBOX-BELOWNAME 와 컴포넌트/CSS 미공유(격자=renderDayCard 인라인 / 생성모달=별도 컴포넌트) → 분리 처리, 본 티켓=격자만.
3. 앵커 단일·RC 명확 → 스샷 게이트 fallback 불요.

## 검증
- build PASS
- E2E: T-20260708-foot-RESVMGMT-BRIEFMEMO-LEFTALIGN.spec.ts 8 PASS
- 회귀: T-20260702-foot-CUSTBOX-PADDING-MEMO-POS.spec.ts 7 PASS (text-left 반영 갱신)
- field-soak: supervisor 갤탭 실기기 좌측정렬 육안 confirm 대기
