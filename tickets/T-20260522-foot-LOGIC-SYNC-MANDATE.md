---
ticket_id: T-20260522-foot-LOGIC-SYNC-MANDATE
title: 동일 로직 전수 매핑 + 연동 체계 수립
status: phase1-complete
priority: P2
domain: foot
created: 2026-05-22
phase: 1
deploy_ready: false
e2e_spec_exempt_reason: ef_only
db_changes: none
code_changes: none
registry_path: memory/_handoff/foot_logic_sync_registry.md
---

## 완료 내역 (Phase 1)

### 스캔 결과
- 대상: `obliv-foot-crm/src/**/*.{ts,tsx}` 122개 파일
- 그룹 수: 10개 (G-001 ~ G-010)
- 전체 매핑 항목: 57개
- 예외 항목: 0개 (현재 현장 지시 없음)

### 레지스트리 위치
`~/claude-sync/memory/_handoff/foot_logic_sync_registry.md`

### 그룹 요약

| 그룹 | 패턴 | 위험도 |
|------|------|--------|
| G-001 | 고객 검색/조회 | 🟠 중 |
| G-002 | 상태 전환 | 🔴 높음 |
| G-003 | 결제 생성 | 🔴 높음 |
| G-004 | 결제 조회 | 🟠 중 |
| G-005 | 권한 체크 | 🔴 높음 |
| G-006 | 전화번호 포맷 | 🟢 낮음 |
| G-007 | 날짜/시간 포맷 | 🟠 중 |
| G-008 | 패키지 세션 | 🟠 중 |
| G-009 | 체크인 조회 | 🟢 낮음 |
| G-010 | 예약 CRUD | 🟠 중 |

### 즉시 처리 권고 (코드 변경 시 묶어 처리)
1. G-006: InlinePatientSearch `toHyphenated()` → `formatPhoneInput()` 대체 (1줄)
2. G-007: CheckInDetailSheet `todaySeoulISODate`/`todaySeoulStr` → `src/lib/format.ts` 이전
3. G-007: DocumentPrintPanel `fmtAmt()` → `formatAmount()` 대체

## Phase 2 (연동 실행)
- 다음 코드 수정 티켓부터 G-{ID} 커밋 태그 적용
- 예외 발생 시 FOLLOWUP → 현장 승인 → exception 마킹 프로세스 적용

## 참고
- Logic Lock: `LOGIC-LOCK-REGISTRY.md` L-005 (2026-05-22 재채번: L-004→L-005, T-20260522-foot-LOCK-RENUMBER-SYNC)
- 레지스트리: `memory/_handoff/foot_logic_sync_registry.md`
