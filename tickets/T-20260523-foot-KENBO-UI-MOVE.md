---
ticket_id: T-20260523-foot-KENBO-UI-MOVE
status: deploy-ready
deploy_ready: true
deploy_ready_at: 2026-05-23T08:30:00+09:00
db_change: false
build_ok: true
e2e_spec: tests/e2e/T-20260523-foot-KENBO-UI-MOVE.spec.ts
domain: foot
priority: P2
deadline: 2026-05-29
---

## T-20260523-foot-KENBO-UI-MOVE — 1번차트 건보공단 조회 위치 이동

### 요약

CheckInDetailSheet 내 건보공단 실시간 자격조회 섹션(NhisLookupPanel)을
**진료이미지 아래 → 예약메모 상단**으로 이동. 기능 변경 없음.

### 변경 내역

**파일**: `src/components/CheckInDetailSheet.tsx`

#### customerMode 섹션
- 제거: 시술항목관리 아래 NhisLookupPanel + Separator (line ~1332)
- 추가: 방문경로 드롭다운 아래, ②예약메모 바로 위 (space-y-3 div 내부)

#### regular checkIn 섹션
- 제거: 진료이미지 아래 `{checkIn.customer_id && (<><Separator /><NhisLookupPanel .../></>)}` 블록 (line ~1873)
- 추가: 방문경로 드롭다운 아래, ②예약메모 바로 위 (space-y-3 div 내부, `checkIn.customer_id &&` 조건 유지)

### AC 체크

- [x] AC-1: 위젯 JSX 렌더 순서 재배치 (예약메모 바로 위) — 양쪽 섹션 모두 적용
- [x] AC-2: 기존 KENBO 자격조회 + fallback 무결성 — NhisLookupPanel 내부 로직 미변경
- [x] AC-3: 태블릿/모바일 레이아웃 깨짐 없음 — space-y-3 div 내 일관 배치

### 빌드

```
✓ built in 3.33s (tsc -b && vite build)
```

### E2E Spec

`tests/e2e/T-20260523-foot-KENBO-UI-MOVE.spec.ts`
- S-1: customerMode — 건보 패널이 예약메모보다 앞에 렌더 (y 좌표 비교)
- S-2: checkIn mode — 건보 패널이 예약메모보다 앞에 렌더
- S-3: 건보 미동의 시 안내 + 조회 버튼 disabled (기능 무결성)
- S-4: 태블릿 viewport (768×1024) 레이아웃 overflow 없음

### 커밋

`05bfcb7` feat(foot): T-20260523-foot-KENBO-UI-MOVE — 건보 자격조회 위치 이동

### 선행 티켓

- T-20260515-foot-KENBO-API-NATIVE (closed)
- T-20260522-foot-CHART1-TRIM (deploy-ready, supervisor QA 대기)
