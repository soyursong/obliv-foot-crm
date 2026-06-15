---
ticket_id: T-20260615-foot-THEME-WHITE-RESTORE-BEIGE-OVERREACH
domain: foot
priority: P2
status: deploy-ready
block_reason: ''
requester: 김주연 총괄 (원 팔레트 확정자 본인)
risk: GO
owner: agent-fdd-dev-foot
approved_by: planner NEW-TASK MSG-20260615-095533-q0q6
stage_done: [code-verify, token-contract-guard, AC6-fullrender-5screens]
stage_pending: [supervisor-QA]
deploy-ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-15
db-change: false
build: pass
spec: tests/e2e/T-20260615-foot-THEME-WHITE-RESTORE-BEIGE-OVERREACH.spec.ts (desktop-chrome 7 pass — :root 토큰계약 가드[white base/중립면/warm 최소/의미색 보존] + 5화면 인증 실렌더 무채면 가드+스샷)
qa_result: self-pass-pending-supervisor
---

# T-20260615-foot-THEME-WHITE-RESTORE-BEIGE-OVERREACH

## 한 줄
6/14 THEME-MONOCHROME-RECOLOR가 베이지를 base 면 전반에 깔아 "모노톤인데 베이지 범벅" 컴플레인 → base 화이트/중립 그레이 복원, 베이지·브라운은 최소 액센트로 격하.

## 결론 (코드 먼저 확인 결과)
- 본 컴플레인은 **직전 RECOLOR 재오픈 정정 커밋 `ad7dbcf`(6/15 09:57)에서 이미 토큰 레벨로 해소**되어 있었음. 본 티켓 NEW-TASK(09:55:33)는 그 정정 커밋과 2분 차이로 사실상 동일 컴플레인을 다룸.
- 따라서 추가 토큰 변경은 불필요(중복·과수정 회피). 대신 **현재 main 상태가 모든 AC를 충족함을 코드 검증 + 실렌더로 객관 증거화**하고, 베이지 base 재유입을 막는 **회귀 가드 spec을 신규 추가**해 완결.
- `src/index.css` 실매핑 grep 결과: 컴포넌트에 하드코딩된 베이지 hex(F8F4EE/E4DDCC 등) **0건** — 베이지는 오직 :root 토큰에서만 왔고, 그 토큰은 이미 중립으로 복원됨.

## AC 검증
- **AC1** `--background`·`--card`·`--popover` = `oklch(1 0 0)` 순수 화이트 ✅
- **AC2** `--secondary`·`--muted`·`--accent`·`--border`·`--input` = chroma 0 무채 중립 그레이 ✅
- **AC3** warm 잔존은 `--primary`(Umber, chroma 0.012)·`--ring`(Taupe, chroma 0.030) 최소 포인트 + 활성탭/CTA만. 범벅 0. 가드 상한 chroma ≤0.08 ✅
- **AC4** carve-out 불변: `--status-*` 11단계·`--chart-*`·`--destructive` 의미색 채도 보존(가드 단언) ✅
- **AC5** `.theme-brown`(셀프접수)·`.dark` warm 값 그대로, :root base 변경 미침범 ✅
- **AC6** 대시보드·예약·고객(차트)·통계·설정 5화면 authed 실렌더 → base 무채(R/G/B 편차≤4, ≥245) 가드 + fullPage 스샷 (evidence/) ✅

## 증거
- evidence/T-20260615-foot-THEME-WHITE-RESTORE-BEIGE-OVERREACH_{dashboard,reservations,customers,stats,settings}.png
- spec: desktop-chrome 7 pass

## 제약 준수
- 팔레트 토큰값(Vanilla/Soft Dune/Umber/Taupe HEX) 삭제 안 함 — base 무채 격하만, 추후 warm-base 재요청 시 재매핑으로 가역.
- 레이아웃·기능·데이터·DB·EF 변경 0. 색 토큰/테스트 한정. (코드 토큰 변경 자체는 직전 정정에서 완료, 본 티켓은 가드 spec만 신규)
- foot 전용. 타 도메인 미접촉.
