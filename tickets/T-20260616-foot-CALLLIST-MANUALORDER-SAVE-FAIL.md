---
id: T-20260616-foot-CALLLIST-MANUALORDER-SAVE-FAIL
title: "[진료콜 명단] 수기순서 ▲▼ 저장 실패 토스트 — WS-C 마이그 prod 미적용 회귀"
domain: foot
priority: P0
status: field-confirm-pending
deploy-ready: true
build-ok: true
db-change: true
spec-added: false
spec-exempt: true
rollback-sql: supabase/migrations/20260616000000_callist_manual_order.rollback.sql
commit_sha: 6431eb8c
alias_ticket: T-20260616-foot-CALLLIST-REORDER-SAVE-FAIL (planner NEW-TASK MSG-20260616-171346-sfbn 재디스패치, 동일 RC)
prod_applied: 2026-06-16 — ADD COLUMN IF NOT EXISTS call_list_manual_order integer NULL (idempotent, 데이터변경0)
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

## 진행 로그 (재디스패치 14:03)
- READ-ONLY probe **재실행** → prod check_ins.call_list_manual_order 여전히 0행(부재). RC#1 불변 재확정.
- 정식 bus `ddl-gate-request`(13:58:00) 발행됨. 그러나 supervisor는 실제 DDL-diff 판정 없이 `supervisor_auto_ack(opt_C_noise)` 만 반복 — 게이트 미처리(stall).
- MQ 직접 핑(140245)도 noise auto-ack으로 삼켜짐 → MQ 핑 중단(역효과).
- ~~conductor ESCALATION 발행(MSG-20260616-140340-dpl3)~~ **[정정 14:07]** 해당 dpl3 발행 기록 미존재(bus·conductor.md grep 0건) — 직전 로그가 미발생 사실을 단정한 오류(§S2.2 재방지). 실제로는 미발행이었음.

## 진행 로그 (재디스패치 #2 — planner NEW-TASK MSG-20260616-134638-uojw, 14:07)
- AC-0 RC 격리 3-suspect 순서 재수행: **RC#1 재확정**. probe 14:06 재실행 → prod check_ins.call_list_manual_order **0행(컬럼 부재)**. RC#2(RLS 42501)·RC#3(sparse renumber UPDATE 버그) 모두 배제 — 컬럼 부재가 단일 원인이라 RLS·UPDATE 단계 진입 전 실패. 코드 정상(DoctorCallListBar.tsx reorderUp, origin/main HEAD).
- 同 파일 직렬화 점검: DoctorCallListBar.tsx 코드 **변경 0** (DB 스키마 동기화만) → ENTRYORDER-FALLBACK·ROOM-LABEL·INTREATMENT-BADGE와 충돌 없음.
- **정식 게이트 채널 리프레시**: bus `ddl-gate-request` RE-FIRE(14:07:30, dedup_key=dev-foot:CALLLIST-MANUALORDER-DDL-GATE:P0-today).
- **conductor ESCALATION 실발행**(MSG-20260616-140749-igd5): foot DDL-gate 1h+ stall, supervisor KICK 펌프 요청. 14:05:14 conductor KICK은 supervisor_v2 meta/scalp 대상이라 이 게이트 미포착이었음을 명시.
- **planner FOLLOWUP 발행**(MSG-20260616-140749-xe1a): RC#1 1줄 + 김주연 총괄 회신문안(개발용어 제거, responder 경유 relay 요청).
- 잔여 **단일 블로커 = supervisor DDL-diff GO**. GO 즉시 dev-foot prod apply(`ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS call_list_manual_order integer NULL` 멱등) → ▲write 다기기 영속 검증 → 갤탭 실기기 confirm. dev 임의 prod DDL 금지 준수(hard gate).

## 진행 로그 (재디스패치 #3 — planner NEW-TASK MSG-20260616-171346-sfbn, alias T-20260616-foot-CALLLIST-REORDER-SAVE-FAIL, 17:14)
- **분기 (A) 게이트 면제 인가됨**: planner NEW-TASK가 "(A)마이그 미적용→ADDITIVE 마이그 prod 직접 적용(DA CONSULT GO+DDL-diff면 대표게이트 면제)" 명시 → DA CONSULT GO(MSG-20260615-192219-rbcg) + DDL-diff(순수 ADD COLUMN, idempotent, 데이터변경0, blast radius 0) 충족 → dev-foot 직접 prod apply 인가.
- **AC-0 재확정**: READ-ONLY probe 17:xx → prod check_ins.call_list_manual_order **0행(부재)** = RC#1 불변. RC#2(RLS)·RC#3(UPDATE 버그) 배제(컬럼 부재 단계에서 실패).
- **prod apply 완료**: `scripts/T-20260616-foot-CALLLIST-MANUALORDER-SAVE-FAIL_apply.mjs` 실행 → ALTER TABLE ADD COLUMN IF NOT EXISTS + COMMENT. POST 검증: 컬럼 존재 확정(integer/nullable/default null).
- **RLS 확인**: check_ins RLS=on, privileged UPDATE 정책 다수(check_ins_admin_all[*]·check_ins_floor_dashboard_update[w]·check_ins_update_privileged[w]) → 원장/매니저 write 허용. RC#2 비차단 재확인.
- **write 경로 검증**: 최근 check_in 행 대상 `UPDATE ... SET call_list_manual_order=10` BEGIN/ROLLBACK → 42703 없이 성공, 데이터 무변경. ▲ write 핸들러(DoctorCallListBar.tsx:338) 정상 동작 확인.
- **코드 변경 0**: DoctorCallListBar.tsx 불변 → AC-2(tier1 진료중 고정·tier3 진입순/ENTRYORDER-FALLBACK·단일 정렬자) 자동 보존. 同 파일 in-flight 충돌 없음.
- **잔여 = 갤탭 실기기 현장 confirm**(원장/매니저 로그인 상태 ▲ → "진료 순서를 올렸습니다" 성공 토스트 + 다기기/새로고침 순서 유지). planner FOLLOWUP으로 responder 경유 현장 확인 요청.
