# T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 2 PROD APPLY 증거

**적용일**: 2026-07-14 (dev-foot) · Management API (project rxlomoozakkjesdqjtvd)
**게이트**: supervisor DDL-diff GO(ticket §197~205) + DA CONSULT-REPLY GO(vdna) + ADDITIVE→대표 게이트 면제(§3.1) + planner apply INFO(MSG-20260714-102243-uvyk)
**러너**: `scripts/T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO_phase2_prod_apply.mjs`

## MIG-GATE 프로토콜 준수 결과 (전부 PASS)

### 1) 멱등 apply
- `20260714120000_selfcheckin_upsert_masked_pii_reject_guard.sql` 무오류 적용 + COMMIT.
- helper + 4 RPC 전부 CREATE OR REPLACE → 재실행 안전.

### 2) 원장 자동 기록 (forward-only)
- PRE: `20260714120000` 미기록(n=0), last-applied=`20260713170000`.
- POST: `supabase_migrations.schema_migrations` version=`20260714120000` name=`selfcheckin_upsert_masked_pii_reject_guard` 기록(ON CONFLICT DO NOTHING 멱등).
- gap/collision(원장) 0.

### 3) post-apply introspection (영속)
- helper `_fn_is_masked_pii` n=1 (secdef=false 순수 predicate, anon EXECUTE grant O).
- 4 대상 RPC 존재: fn_selfcheckin_upsert_customer / _resolve_v2 / _resolve_v3 / self_checkin_create.

### 4) divergence 없음 (dry-run 재현분 ↔ 실적용)
- predicate 정오탐 10/10 — masked 4종(name*/phone*/tail4/d4)=true, raw 6종(raw/e164/8자리↑/빈/email-only/DUMMY)=false. false-reject 0.
- 가드 fail-closed: masked payload → `SQLSTATE 22023` 발화(resolve_v3·self_checkin_create 실증).
- 무삽입: 가드 테스트(masked '총**트'/tail 7754)로 인한 신규 customers row 삽입 0.

## 결과
✅✅ **PROD APPLY PASS — 영속·원장기록·divergence0**

## ⚠️ 인접 발견 (별건, planner FOLLOWUP 통지)
- 레포 내 마이그 파일 **버전 충돌**: `20260714120000_selfcheckin_upsert_masked_pii_reject_guard.sql` 과
  `20260714120000_calc_copayment_hira_governed_elderly_tiers.sql` 이 동일 version 문자열(20260714120000) 공유.
- 본 티켓분만 원장 기록됨 → copayment 마이그가 `supabase db push` 경로로 적용 시 version 선점으로 **skip 위험**.
- copayment 마이그는 별건 → 고유 version(예: 20260714120001)로 재부여 필요. planner 통지.

## 하류(별건, apply 후 선행조건 충족)
- CONTAM-BACKFILL freeze 재산출 2차 패스(07-14 신규 오염행 b1b5f6f7) — 본 소스차단 apply 가 선행조건 → 충족.
