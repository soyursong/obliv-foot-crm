---
ticket_id: T-20260522-foot-DESIGNATED-THERAPIST
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-29
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260522-foot-DESIGNATED-THERAPIST.spec.ts
db_changed: true
rollback_sql: supabase/migrations/20260522070000_designated_therapist.down.sql
risk_level: GO_WARN (2/5)
---

# T-20260522-foot-DESIGNATED-THERAPIST — 지정 치료사 기능

## 승인
- 김주연 총괄 구두 승인 완료 (2026-05-22)

## 구현 완료 항목

### AC-1: 지정 치료사 드롭다운 UI
- **위치**: 2번차트 우측 패널 > 예약내역 ↔ 회차차감 사이
- **데이터 소스**: `staff` 테이블 (role = 'therapist', active = true)
- **testid**: `designated-therapist-select`
- **자동저장**: 드롭다운 onChange 즉시 저장 (toast 피드백)
- 코드: `CustomerChartPage.tsx` 약 4451 라인 전후

### AC-2: DB 스키마
- 마이그레이션: `supabase/migrations/20260522070000_designated_therapist.sql`
  ```sql
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS designated_therapist_id UUID
    REFERENCES staff(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_customers_designated_therapist
    ON customers(designated_therapist_id)
    WHERE designated_therapist_id IS NOT NULL;
  ```
- 롤백: `supabase/migrations/20260522070000_designated_therapist.down.sql`
- TypeScript 타입: `src/lib/types.ts` Customer 인터페이스에 `designated_therapist_id?: string | null` 추가

### AC-3: 재진 회차 차감 시 지정 치료사 자동 선택
- `useEffect`: `[designatedTherapistId, therapistList]` 의존 — therapistList 확정 후 c22DeductForm.therapistId에 pre-fill (현재 값 없는 경우만)
- 차감 완료 후 reset: 지정 치료사로 자동 복원 (`customer.designated_therapist_id ?? ''`)
- 저장 함수 `saveDesignatedTherapist`: 변경 시 c22DeductForm 실시간 동기화

### AC-4: 매출집계 → 치료사별 [지정환자수]
- 파일: `src/components/sales/SalesStaffTab.tsx`
- 쿼리: `customers WHERE clinic_id = ? AND designated_therapist_id IS NOT NULL` → 클라이언트 group-by
- 컬럼 추가: `지정환자수` (치료사 역할만, 기술직은 `—` 표시)
- 양수 값이면 emerald 강조색 표시
- tfoot 합계행에 `—` (의미없는 합산 방지)

## E2E 시나리오 (6건)
| SC | 설명 | 시드 필요 |
|----|------|-----------|
| SC-1 | 드롭다운 렌더 + 위치 검증 | Y |
| SC-2 | 드롭다운 변경 → 토스트 노출 | Y |
| SC-3 | 재방문 시 지정 치료사 유지 | Y |
| SC-4 | 변경 → 회차 차감 폼 자동 동기화 | Y |
| SC-5 | 매출집계 담당직원별 탭 컬럼 확인 | N |
| SC-6 | 없음 선택 → 해제 토스트 | Y |

## 변경 파일 목록
| 파일 | 변경 유형 |
|------|----------|
| `supabase/migrations/20260522070000_designated_therapist.sql` | NEW (DB 마이그레이션) |
| `supabase/migrations/20260522070000_designated_therapist.down.sql` | NEW (롤백 SQL) |
| `src/lib/types.ts` | EDIT (Customer 타입 확장) |
| `src/pages/CustomerChartPage.tsx` | EDIT (상태·함수·UI 추가) |
| `src/components/sales/SalesStaffTab.tsx` | EDIT (지정환자수 컬럼) |
| `tests/e2e/T-20260522-foot-DESIGNATED-THERAPIST.spec.ts` | NEW (E2E 6건) |
| `tickets/T-20260522-foot-DESIGNATED-THERAPIST.md` | NEW (이 파일) |

## 리스크 & 미티게이션
- **DB 스키마 변경**: supervisor migration 리뷰 필수. `ON DELETE SET NULL` 보장으로 staff 삭제 시 데이터 유실 없음.
- **예약 핵심 경로 비즈로직**: c22DeductForm therapistId pre-fill은 "현재 값 없을 때만" 조건으로 기존 수동 선택 흐름 보호.
- **회귀**: 회차 차감 기존 기능 코드 블록 불변. useEffect는 신규 의존성만 추가.
- **SalesStaffTab 쿼리 추가**: 기존 payments 쿼리 불변. designatedMap은 별도 쿼리 (캐시 키 분리).

## 빌드 결과
```
✓ built in 3.35s
```

## supervisor 체크리스트
- [ ] Supabase 운영 DB 마이그레이션 실행 (20260522070000_designated_therapist.sql)
- [ ] Vercel 프리뷰 배포 확인 (main merge 자동)
- [ ] 현장 시뮬레이션: 지정 치료사 설정 → 차트 재진입 → 유지 확인
- [ ] 기존 회차 차감 E2E 회귀 통과 확인
