---
ticket_id: T-20260522-foot-CLOSING-STAFF-DROP
domain: foot
status: deploy-ready
deploy_ready: true
scope: FE-only
db_changed: false
build_passed: true
e2e_spec: false
summary: "일마감 결제내역 [담당자] 드롭다운을 2번차트 1구역 담당자 드롭과 동일 쿼리/필터/정렬로 통일. director 제외 필터 추가."
---

## T-20260522-foot-CLOSING-STAFF-DROP — 일마감 결제내역 [담당자] 드롭다운 2번차트와 동일하게 변경

### 요약
일마감 → 결제내역 화면의 [담당자] 드롭다운 옵션 목록이 2번차트 [담당자] 드롭다운과 불일치.
동일 staff 테이블 기반으로 동일 쿼리·동일 필터·동일 정렬·동일 표시명으로 통일.

### 변경 내용

#### 1. staffList 쿼리 통일 (`src/pages/Closing.tsx` ~line 376)

**Before:**
```ts
.eq('active', true)
.order('name');
```

**After:**
```ts
.eq('active', true)
.in('role', ['consultant', 'coordinator', 'director', 'therapist'])
.order('name', { ascending: true });
```

2번차트 (CustomerChartPage.tsx ~line 1393) 쿼리와 동일.

#### 2. 드롭다운 렌더 필터 추가 (`src/pages/Closing.tsx` ~line 1188)

**Before:**
```tsx
{staffList.map(s => (
  <option key={s.id} value={s.name}>{s.name}</option>
))}
```

**After:**
```tsx
{/* T-20260522-foot-CLOSING-STAFF-DROP AC-1: 2번차트 동일 — role='director'(원장) 코드 레벨 제외 */}
{staffList.filter(s => s.role !== 'director').map(s => (
  <option key={s.id} value={s.name}>{s.name}</option>
))}
```

2번차트 `C2-MANAGER-PAYMENT-MAP v3` 주석 기준과 동일.

### AC 검증
- **AC-1** ✅ — 드롭다운 옵션: `consultant + coordinator + therapist` (director 제외), active=true, name 오름차순 정렬. 2번차트 동일.
- **AC-2** ✅ — `staffMap`은 staffList 전체(director 포함)에서 구성 → assigned_staff_id 매핑 정상. CLOSING-PAY-3COL(assigned_staff_id 연동)·DAILY-SETTLE-STAFF(staffTotals 집계) 미영향.
- **AC-3** ✅ — FE-only 변경. DB 쿼리 row 수만 줄어드는 최적화. 스크린샷 재현 지점(director 노출) 해소.

### 빌드
- `npm run build` ✅ — 3.21s 완료, 에러 없음
- DB 변경: 없음
