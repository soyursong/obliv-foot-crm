---
id: T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP
title: "[2번차트] 서류발행→예약내역 탭 대체 + 수납↔체류시간 그룹 스왑 + 체류시간 무한로딩 RC"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 014944f
created: 2026-06-15
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-140433-d74m
risk_verdict: GO
---

# T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP

FIELDBATCH-0613 item8가 "기구현" 오마킹했던 건을 본 티켓에서 일원화 처리. CustomerChartPage.tsx 실반영.

## AC-1 — 서류발행 → 예약내역 탭 대체 + 2구역 패널 이동 ✅
- `CLINICAL_TABS`의 `{ key:'documents', label:'서류발행' }` → `{ key:'reservations', label:'예약내역' }` 대체.
- 서류발행 렌더 블록(`chartTab === 'documents'`)은 **orphan 보존**(MUNJIN-DEDUP 선례 — 진입점만 제거).
- 2구역(우측 사이드) 예약내역 패널을 `chartTab === 'reservations'` 탭 콘텐츠로 이동. 핸들러·testid(`btn-next-reservation`, `ReservationAuditLogPanel`) 동일 보존.
- 2구역에서 예약내역 패널 제거(최근방문 위젯은 2구역 유지 — planner 명시 line range L6571~ = 예약내역 패널만).
- `IMPLEMENTED_CLINICAL`에 `reservations` 추가(서류발행 제거) → "준비 중" placeholder 미노출.

## AC-3 — 수납내역(payments) ↔ 체류시간(slot_dwell) 그룹 스왑 ✅
- payments → HISTORY 그룹, slot_dwell → CLINICAL 그룹으로 이동(탭 정의 + IMPLEMENTED 배열).
- 렌더 가드 `chartTabGroup === '...' && chartTab === '...'` → **group 비종속(`chartTab === '...'` 단독)** 으로 교체(키 유일성 보장). 스왑으로 인한 group-coupling 회귀 차단.

## AC-5 — slot_dwell 체류시간 탭 무한로딩 ROOT CAUSE 제거 ✅ (추정구현 금지)
**RC(코드 근거)**: lazy-load effect의 deps에 `slotDwellLoading`이 포함되고 가드에도 사용됨.
`setSlotDwellLoading(true)` 순간 effect가 즉시 재실행 → cleanup이 in-flight 요청에 `cancelled=true`를 세팅 →
RPC resolve 시 `if (cancelled) return;`가 `setSlotDwellLoading(false)` 앞에서 조기반환 →
**loading이 true로 영구 고착("계속 로딩만 됨")**. c9dd3c4의 빈-ids 가드는 ids≠0(실데이터) 경로의 이 레이스를 못 잡음.

**수정**:
- effect deps에서 `slotDwellLoading` 제거, 가드는 `slotDwellLoaded`만(자기-취소 트리거 차단).
- `setSlotDwellLoading(true)`를 async 밖에서 1회 호출 → loading 상태변화가 effect 재실행을 유발하지 않음.
- checkInHistory 변경 등 정상 재실행 시에만 cleanup이 stale 요청 취소(데이터 적용만 차단, loading은 신규 실행이 소유).
- AC-3 스왑과 동일 패스에서 처리 — lazy 로딩 가드도 group 비종속화(slot_dwell이 clinical 그룹에서도 동작).

**DoD**: 데이터 있으면 표 / 없으면 "기록 없음" 빈상태 / 빈-ids면 로딩 안 켜고 대기 — **어느 경우도 무한로딩 고착 X**.

## ⚠ 분리 확인
- 본 slot_dwell(CustomerChartPage 2번차트 탭)은 `T-20260615-foot-RESV-DWELL-LOADING-STUCK`(Reservations.tsx 경과분석)와 **별개 화면**.

## 검증
- build OK (vite 3.87s).
- E2E: `tests/e2e/T-20260615-foot-CHART2-TABS-RESVTAB-DWELLSWAP.spec.ts` 신규 7 PASS
  (탭 멤버십 AC-1·AC-3 / 키 유일성 / AC-5 RC 시뮬레이터 BUGGY 재현 + FIXED + 빈-ids).
- DB 변경: 없음.
- supervisor 실QA: 운영 번들 grep(documents 탭 미존재·reservations 탭 존재·payments/slot_dwell 그룹 스왑) + 갤탭 실기기 체류시간 탭 무한로딩 없음 확인.
