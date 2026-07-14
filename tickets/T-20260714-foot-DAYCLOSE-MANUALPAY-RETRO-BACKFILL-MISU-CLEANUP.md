---
id: T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP
domain: foot
priority: P1
status: phaseA-done-phaseB-blocked
phase_a: DONE (read-only 리포트 산출, write 0)
phase_b: BLOCKED (3중 게이트 미충족 — 착수 금지)
db_change: false
db_migration: none
build: n/a (read-only 조사 티켓 — 코드 변경 없음, 프로덕션 로직 무변경)
report: db-gate/T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP_phaseA_report.md
scripts:
  - scripts/T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP_probe.mjs
  - scripts/T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP_match.mjs
  - scripts/T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP_misu.mjs
depends_on:
  - DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC (canonical write-path 포크 결정 = 게이트1)
  - CHART2-RECEIPT-MANUALPAY-POPUP (동일 write-path 표면)
created: 2026-07-14
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260714-160616-xpvr)
---

# T-20260714-foot-DAYCLOSE-MANUALPAY-RETRO-BACKFILL-MISU-CLEANUP

급여환자 전수 수기수납(PAYMINI P0 workaround) + 미수 미연동(DAYCLOSE) 구간에서 누적된
chart/customer 미링크 수기수납 레코드 + 잘못 남은 미수를 소급 정정하는 백필 티켓.
김주연 총괄 요청("차트번호/성함 매핑 → 2번차트 반영 + 미수 정리").

## Phase A (DONE — read-only, write 0)
1. 대상 후보 추출: 버그구간(2026-07-14 단일일) ∩ 버그경로 지문(closing_manual_payments 워크어라운드
   테이블에 free-text 로만 남아 canonical payments/package_payments 미생성) 교집합 = **13건**.
2. 매칭 리포트 3분류: **1:1확정 13 / 다중후보 모호 0 / 무매칭 0**.
3. 미수 대사: 클린 백필군 11건(10고객, 소액 체험 — 패키지 잔금 미해소) / 정밀검토군 2고객(이미현·허유희,
   당일 canonical 결제 병존 → 이중계상 위험).
   → 상세: 리포트 파일(frontmatter `report`).

## Phase B (BLOCKED — 3중 게이트, 착수 금지)
- (게이트1) DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC write-path 포크 결정 = canonical 수납 write-path 확정.
- (게이트2) data-architect CONSULT — Cross-CRM Data-Correction 백필 SOP.
- (게이트3) dry-run + 김주연 총괄 사람 confirm(매칭 규칙·미수 정리 정의).
- 신규 병렬 write 경로 신설 금지 — `manualPaymentWritePath.recordManualPayment` canonical 재사용. ADDITIVE 정정만.
