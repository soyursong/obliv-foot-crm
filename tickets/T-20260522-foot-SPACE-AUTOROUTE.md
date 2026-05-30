---
id: T-20260522-foot-SPACE-AUTOROUTE
title: 1번차트 공간배정 드롭다운 삭제 + 금일동선 자동기입 전환
domain: foot
priority: P1
status: deploy-ready
created: 2026-05-22
deploy-ready: true
build-status: pass
db-change: true
db-migration: supabase/migrations/20260529000010_check_in_room_logs_rls_fix.sql
spec-file: tests/e2e/T-20260522-foot-SPACE-AUTOROUTE.spec.ts
spec-count: 6
commit: b33aa49
---

# T-20260522-foot-SPACE-AUTOROUTE — 공간배정 드롭다운 삭제 + 금일동선 자동기입

## 요청

1번차트(CheckInDetailSheet) 공간배정 수동 드롭다운 제거, 대시보드 DnD/칸반 이동 시
`check_in_room_logs` 자동 INSERT → 금일동선(4슬롯) 자동 표기.

## 구현 커밋

| 커밋 | 내용 |
|------|------|
| a7d26e1 | 원본 — DnD room drop → check_in_room_logs 자동 기입 + 4슬롯 E2E spec |
| b33aa49 | REOPEN1 — 금일동선 Realtime 구독 + RLS 마이그레이션 추가 |

## AC 충족

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 1번차트 공간배정 드롭다운 제거 | ✅ |
| AC-2 | 금일동선 섹션(4슬롯) 항상 표시 | ✅ |
| AC-3 | 당일 room_assignments 자동 집계 (check_in_room_logs 기반) | ✅ |
| AC-4 | DnD 이동 시 check_in_room_logs INSERT | ✅ Dashboard.tsx 4068 |
| AC-5 | 치료실(C1~C10) 이동도 금일동선 표기 | ✅ room_type='treatment' |
| AC-6 | 레이저실(L1~L12) 이동도 금일동선 표기 | ✅ room_type='laser'/'heated_laser' |
| AC-7 | 상담실 배정도 금일동선 표기 | ✅ room_type='consultation' |
| AC-8 | 회귀 없음 — 1번차트 에러 없이 오픈 | ✅ E2E S-4 |
| **AC-9** | 금일동선 데이터 소스 확인 (REOPEN1) | ✅ check_in_room_logs (CheckInDetailSheet.tsx:820) |
| **AC-10** | RLS 정책 오류 수정 (REOPEN1) | ✅ 20260529000010 마이그레이션 — user_id→id 수정 |
| **AC-11** | 치료실/레이저실 배정 후 금일동선 자동 표기 | ✅ Realtime 구독 추가(CheckInDetailSheet.tsx:851~) |

## REOPEN1 근본 원인

```sql
-- 원본 (잘못됨): user_profiles.user_id 컬럼 미존재
WHERE user_id = auth.uid()

-- 수정: user_profiles PK = id
WHERE id = auth.uid()
```

RLS 정책 CREATE 실패 → SELECT/INSERT 전부 거부 → 금일동선 영구 빈 상태.
`20260529000010_check_in_room_logs_rls_fix.sql`로 수정 완료 + 오늘 날짜 backfill INSERT.

## DB 변경

```
supabase/migrations/20260529000010_check_in_room_logs_rls_fix.sql
supabase/migrations/20260529000010_check_in_room_logs_rls_fix.down.sql
```

supervisor 적용 필요.

## 빌드

```
✓ built in 3.49s
```

## E2E

```
6 TC (S-1~S-6): 공간배정 드롭다운 미존재, 금일동선 4슬롯, Realtime 구독
```
