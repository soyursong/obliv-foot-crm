---
id: T-20260529-foot-RESV-CHECKIN-NOSAVE
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-05-29 16:35
completed: 2026-05-29
deadline: 2026-06-02
db_changed: true
db_migration: supabase/migrations/20260529010000_resv_checkin_unique_fix.sql
db_rollback: supabase/migrations/20260529010000_resv_checkin_unique_fix.rollback.sql
db_deployed: true
e2e_spec: tests/e2e/T-20260529-foot-RESV-CHECKIN-NOSAVE.spec.ts
risk_verdict: GO_WARN
risk_reason: "DB 인덱스 재정의 완료 (live). FE 에러 핸들링 개선. Walk-in 무영향 확인."
author: dev-foot
---

# T-20260529-foot-RESV-CHECKIN-NOSAVE — 예약 기반 셀프접수 저장 안 됨 (P1)

## 상태

**deploy-ready** — DB 마이그레이션 live 배포 완료 + FE 에러 핸들링 개선 + E2E spec

## Root Cause

`unique_reservation_checkin` 인덱스에 `cancelled` 상태 제외 조건이 없었음:

```sql
-- 기존 (문제)
CREATE UNIQUE INDEX unique_reservation_checkin
  ON check_ins (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- 수정 후
CREATE UNIQUE INDEX unique_reservation_checkin
  ON check_ins (reservation_id)
  WHERE reservation_id IS NOT NULL
    AND status <> 'cancelled';
```

**시나리오**:
1. 예약 체크인 생성 (R1) → trigger가 reservation status → checked_in
2. 스태프가 체크인 취소 (status = cancelled)
3. 스태프가 예약 status 수동 복원 → confirmed
4. 고객 셀프접수 재시도 → INSERT with reservation_id=R1
5. 기존 인덱스: cancelled 체크인(R1)과 충돌 → **23505 unique violation**
6. ciErr 설정 → setStep('error') → "접수 실패" 화면

**Walk-in이 정상인 이유**: `reservation_id = null` → 인덱스 WHERE 조건 미적용

## 수정 내역

### DB (20260529010000_resv_checkin_unique_fix.sql)
- `unique_reservation_checkin` 인덱스 DROP + `AND status <> 'cancelled'` 조건으로 재생성
- **live 배포 완료** (2026-05-29)
- 롤백: `20260529010000_resv_checkin_unique_fix.rollback.sql`

### FE (src/pages/SelfCheckIn.tsx)
- AC-4: `ciErr.code === '23505'` 분기 추가
  - 기존: raw DB 에러 메시지 표시
  - 변경: "이미 접수된 예약입니다. 대기열을 확인하거나 직원에게 문의해 주세요."
- KO/EN 양국 메시지 추가 (`duplicateCheckIn`)

## AC 달성 현황

| AC | 기준 | 상태 |
|----|------|------|
| AC-1 | 예약 경로 체크인 저장 정상 | ✅ DB 인덱스 재정의로 해결 |
| AC-2 | Root cause 특정 | ✅ 23505 unique violation (cancelled 인덱스 포함) |
| AC-3 | Walk-in 무영향 | ✅ reservation_id=null → 인덱스 미적용 확인 |
| AC-4 | 에러 핸들링 | ✅ 23505 → 사용자 친화 메시지 |

## 변경 이력

- 2026-05-29 16:35 — 티켓 생성 (approved, P1)
- 2026-05-29 — dev-foot 구현 완료:
  - DB 마이그레이션 배포 (live)
  - FE 에러 핸들링 개선
  - E2E spec 작성
  - deploy-ready 마킹
