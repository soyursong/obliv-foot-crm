---
id: T-20260616-foot-CALLLIST-MANUALORDER-SAVE-FAIL
title: "[진료콜 명단] 수기순서 ▲▼ 저장 실패 토스트 — WS-C 마이그 prod 미적용 회귀"
domain: foot
priority: P0
status: gate-pending
deploy-ready: false
build-ok: true
db-change: true
spec-added: false
spec-exempt: true
rollback-sql: supabase/migrations/20260616000000_callist_manual_order.rollback.sql
commit_sha: pending
created: 2026-06-16
assignee: dev-foot
reporter: 김주연 총괄
source_msg: MSG-20260616-134638-uojw
rc: "RC#1 — prod check_ins.call_list_manual_order 컬럼 부재(마이그 20260616000000 prod 미적용). 코드 정상, DB 스키마 미동기화"
---

# T-20260616-foot-CALLLIST-MANUALORDER-SAVE-FAIL — 수기순서 저장 실패 RC 격리

## 증상
진료콜 명단 수기순서 ▲(▼) 변경 시 "순서 변경 저장 실패 — 잠시 후 다시 시도해주세요" 토스트.
어제 배포 WS-C(T-20260615-foot-CALLLIST-ROOMSUMMARY-NUM-REORDER, commit 4a0c4db8) 직후 발생.

## AC-0 RC 격리 (3-suspect 순서, READ-ONLY probe)
probe: `scripts/T-20260616-foot-CALLLIST-MANUALORDER-SAVE-FAIL_ac0_probe.mjs`

### ✅ RC#1 확정 — 마이그 prod 미적용
```sql
SELECT column_name,data_type,is_nullable FROM information_schema.columns
 WHERE table_name='check_ins' AND column_name='call_list_manual_order';
-- 결과: 0행 → 컬럼 부재
```
- WS-C 커밋 메시지 명시: "⚠ supervisor DDL-diff 게이트 선행 — **prod 컬럼 적용 후** ▲ write GO."
- 즉 코드(▲ write)는 배포됐으나 마이그(20260616000000_callist_manual_order.sql) prod 적용이 누락된 채 라이브.
- 동작 경로: `DoctorCallListBar.tsx:338` `.update({ call_list_manual_order: (i+1)*10 })` → PostgREST가 존재하지 않는 컬럼 write → error → `:347` `toast.error('순서 변경 저장 실패…')`.
- 코드 라인 323 주석이 이 케이스를 이미 예견: "write 실패(예: 마이그 전 컬럼 부재)는 toast로 graceful".

### ✗ RC#2 배제 — RLS 무관
컬럼 자체가 부재하므로 RLS(42501) 단계 진입 전에 실패. RC#1로 종결.

### ✗ RC#3 배제 — sparse renumber UPDATE 버그 무관
UPDATE문(`(i+1)*10`, Promise.all 다건)은 컬럼만 존재하면 정상. 컬럼 부재가 단일 원인.

## 수정 (코드 변경 0 — DB 스키마 동기화만)
ADDITIVE 마이그 prod 보충 적용:
```sql
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS call_list_manual_order integer NULL;
-- 롤백: ALTER TABLE check_ins DROP COLUMN IF EXISTS call_list_manual_order;
```
- 근거: data-architect CONSULT GO (MSG-20260615-192219-rbcg, ADDITIVE / contract_required:false / blast radius 0).
- 절차: supervisor DDL-diff + 롤백SQL 게이트 통과 후 적용 (autonomy §3.1 대표게이트 면제, dev 임의 prod DDL 금지).

## AC-1 (적용 후 검증)
- ▲ 클릭 → "진료 순서를 올렸습니다" 성공 토스트.
- 다른 기기/새로고침 후에도 순서 유지(check_ins 영속 → realtime 공유).

## AC-2 회귀금지 (코드 불변이므로 자동 보존)
- compareCallOrder 단일 정렬자: tier1 진료중고정 > tier2 수기override(manual_order asc) > tier3 진입순.
- inclusion/status 전이 불변. 마이그 적용 전 NULL 행은 전부 tier-3 수렴(backward-compatible).
