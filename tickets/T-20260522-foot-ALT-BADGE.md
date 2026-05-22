---
id: T-20260522-foot-ALT-BADGE
title: ALT 배지 + 상담 ALT 버튼 + 고객메모 고정 + 자동 연동
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
build_ok: true
db_changed: true
db_rollback_sql: supabase/migrations/20260522080000_alt_badge.down.sql
spec_added: tests/e2e/T-20260522-foot-ALT-BADGE.spec.ts
---

# T-20260522-foot-ALT-BADGE — ALT 배지 + 상담 ALT 버튼 + 고객메모 고정 + 자동 연동

## 요약

올트(ALT) 배지 시스템 전체 구현:
- 2번 차트 상담 탭 > 담당자 드롭 하단 ALT ON/OFF 버튼 + 상세내용 입력 필드
- 대시보드 고객 카드 메탈릭 실버 [ALT] 배지
- 고객메모 히스토리 고정(pin) 기능
- ALT 활성화 시 고정 메모 자동 기입 + 서류출력 레이저코드 차단

## AC 이행 상세

### AC-1 ✅ 상담 탭 ALT 버튼 + 상세내용 필드
- 파일: `src/pages/CustomerChartPage.tsx` (line 4758~)
- 위치: 3구역 상담 탭 > 담당자 드롭다운 하단
- ON/OFF 버튼 2개 + 상세내용 textarea
- 데이터: `data-testid="alt-on-btn"`, `data-testid="alt-off-btn"`, `data-testid="alt-detail-input"`

### AC-2 ✅ 대시보드 메탈릭 실버 [ALT] 배지
- 파일: `src/pages/Dashboard.tsx` (AltHolderCtx, DraggableCard)
- `fetchAltHolders()` — `customers.alt_status=true` 집합 조회
- 메탈릭 실버 그라데이션: `linear-gradient(135deg, #c8c8c8 0%, #e8e8e8 40%, #b0b0b0 60%, #d4d4d4 100%)`
- 재진 카드(DraggableCard)와 초진 카드(Box2) 모두 적용

### AC-3 ✅ 고객메모 히스토리 + [고정] 기능
- 파일: `src/components/ReservationMemoTimeline.tsx`
- `is_pinned=true` 메모 최상단 고정 + 핀 아이콘 표시
- 고정/해제 토글: `togglePin()` — DB UPDATE + 낙관적 UI 갱신
- 고정 메모 배경: `border-teal-300 bg-teal-50`

### AC-4a ✅ ALT ON → 고정 메모 자동 기입
- 파일: `src/components/ReservationMemoTimeline.tsx` (`insertAltPinnedMemo`)
- ALT 활성화 시 호출: `"ALT 대상 — {alt_detail}"` 고정 메모 자동 삽입
- `is_pinned=true`, `pinned_at=now()` 자동 설정

### AC-4b ✅ ALT ON → 서류출력 레이저코드 차단 (개념 정정 반영)
- 파일: `src/components/DocumentPrintPanel.tsx`
- `isLaserService()` — category(laser/heated_laser), 이름('레이저'), 코드(MM*) 판별
- 레이저 서비스 삽입 시도 → `toast.error` + return 차단
- **수정**: `CustomerChartPage.tsx` DocumentPrintPanel 2곳에 `altStatus` prop 전달 추가
  - line ~4178: 메인 서류발행 (`altStatus={altStatus}`)
  - line ~3787: 재발급 다이얼로그 (`altStatus={altStatus}`)

### AC-5 ✅ 기존 동작 미영향 + 기존 메모 보존
- 기존 `reservation_memo_history` rows: `is_pinned=false` DEFAULT → 기존 데이터 영향 없음
- `customer_memo`, `tm_memo` 필드: ALT 업데이트에서 건드리지 않음
- ALT OFF 시 모든 차단 자동 해제

## DB 변경

### 마이그레이션: `supabase/migrations/20260522080000_alt_badge.sql`
**적용 완료 (2026-05-22 13:23)**

```sql
-- customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS alt_status        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alt_detail        text,
  ADD COLUMN IF NOT EXISTS alt_activated_at  timestamptz;

-- reservation_memo_history
ALTER TABLE reservation_memo_history
  ADD COLUMN IF NOT EXISTS is_pinned  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at  timestamptz;
```

### 롤백 SQL: `supabase/migrations/20260522080000_alt_badge.down.sql`

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/lib/types.ts` | `ReservationMemoHistory` — `reservation_id` nullable, `customer_id`/`check_in_id`/`is_pinned`/`pinned_at` 필드 추가 |
| `src/pages/CustomerChartPage.tsx` | ALT ON/OFF 버튼 + 상세 필드 (AC-1) + DocumentPrintPanel 2곳 `altStatus` prop 전달 (AC-4b fix) |
| `src/pages/Dashboard.tsx` | AltHolderCtx, fetchAltHolders, 메탈릭 실버 ALT 배지 (AC-2) |
| `src/components/ReservationMemoTimeline.tsx` | 핀/언핀 토글, `insertAltPinnedMemo` helper, 정렬 로직 (AC-3, AC-4a) |
| `src/components/DocumentPrintPanel.tsx` | `isLaserService`, `altStatus` prop, 레이저코드 차단 (AC-4b) |
| `supabase/migrations/20260522080000_alt_badge.sql` | DB 스키마 추가 |
| `supabase/migrations/20260522080000_alt_badge.down.sql` | 롤백 SQL |
| `tests/e2e/T-20260522-foot-ALT-BADGE.spec.ts` | E2E 스펙 9개 |

## 빌드 결과

```
✓ built in 3.22s (2026-05-22, TypeScript 오류 없음)
```

## 참고 / 결정 사항

- "서류 자동 출력(AC-4b)" 개념 정정 (김주연 총괄, ts:1779421309):
  - 변경 전(틀림): 서류출력 시 레이저코드 자동 삭제/복원
  - 변경 후(정정): 서류출력 리스트에 레이저코드 삽입 자체를 차단
- ALT는 "보험 반려 → 레이저 비급여 병행" 대상 고객 표식
- 메탈릭 실버 배지 컬러는 단순 회색 금지(그라데이션 필수)
