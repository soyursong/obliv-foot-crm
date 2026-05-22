---
id: T-20260522-foot-CHART1-TRIM
domain: foot
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
e2e_spec: false
commit: 1c8ef57
summary: "1번차트 불필요 항목 4건 제거 + 금일 동선 표기 보정"
---

## T-20260522-foot-CHART1-TRIM — 1번차트 불필요 항목 제거 + 금일 동선 표기 보정

**P2 | FE-only | completed: 2026-05-23**

### AC 완료 내역

- AC-1: "패키지 잔여회차" 항목 제거 ✅ (ActivePackageSummary 컴포넌트 삭제)
- AC-2: "체크리스트" / "비급여동의서" 항목 제거 ✅ (섹션 삭제, 모달은 유지)
- AC-3: 공간배정 드롭다운 완전 제거 → [금일 동선] 항상 표시 통합 ✅
- AC-4: [금일 동선] 치료실/레이저실 항상 표기 ✅ (logs 없는 슬롯 "—" placeholder)

### 변경 파일

- `src/components/CheckInDetailSheet.tsx` (46 insertions, 473 deletions)
  - ActivePackageSummary 컴포넌트 제거
  - 체크리스트/동의서 섹션 제거 (양 모드: customerMode + checkIn)
  - todayRoomLogs useMemo 제거 (금일 이동이력 섹션 제거)
  - dailySlotSummary: filter→map, null 허용 (4슬롯 항상 반환)
  - DocumentViewer import 제거
  - docRefreshKey state 제거

### 빌드 결과

- `npm run build` → ✅ 3.19s
- `git push origin main` → ✅ 1c8ef57
- DB 변경: 없음
