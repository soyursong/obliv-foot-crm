# T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE — PROD MIG-APPLY POST-PROBE 증거

- **ticket**: T-20260801-foot-INFLOW-KIOSK-SELFCHECKIN-COVERAGE
- **mig version**: 20260807120000_foot_inflow_kiosk_selfcheckin_candidate
- **feature commit**: eed9951c (C12 REF-COLUMN GUARD 복원본)
- **apply script commit**: 8e418038
- **gate**: supervisor MIG-GATE-APPROVAL DB-GATE-REPLY MSG-20260807-164004-8x2p (canonical, verdict=GO) — MSG-20260807-163926-otqr 대체
- **§5 원칙**: apply = dev-foot 책임 / supervisor = 사전승인 + POST-APPLY 사후검증
- **prod**: rxlomoozakkjesdqjtvd (obliv-foot-crm)
- **applied by**: dev-foot (apply_20260807120000_..._candidate.mjs --apply)
- **date**: 2026-08-07 KST

## 적용 내용 (전량 ADDITIVE / 멱등)
- Step 0 [ledger reconciliation]: `checklists.storage_path` / `started_at` ADD COLUMN IF NOT EXISTS (nullable)
- Step 1: `check_ins.inflow_channel_self_reported` ADD COLUMN IF NOT EXISTS (text, nullable) — candidate hint
- Step 2: `fn_complete_prescreen_checklist` CREATE OR REPLACE (candidate write 델타, canonical 무접점)

## POST-PROBE 실측 (apply 후)

| 항목 | 기대 | 실측 | 판정 |
|------|------|------|------|
| [E1] checklists.storage_path/started_at 실재 | nullable=YES ×2 | started_at:YES, storage_path:YES | PASS |
| [E3] SELECT storage_path FROM checklists LIMIT 0 | 42703 미발생 | `[]` (성공) | PASS |
| [E1] check_ins.inflow_channel_self_reported 실재 | text, nullable=YES | text, YES | PASS |
| canonical inflow_channel 컬럼 존치 | present | present | PASS |
| fn SECDEF / search_path / owner | secdef=t, search_path="", owner=postgres | secdef=t, `["search_path=\"\""]`, postgres | PASS |
| anon EXECUTE | true | true | PASS |
| fn md5 | (candidate write 포함본) | `ca2f6bfcfd284d8757dc89a251838f4e` | PASS |
| self_reported_pos (본문 내 candidate write 존재) | >0 | 2246 | PASS |
| ledger row 20260807120000 | present | present | PASS |

## 방화벽 확인 (DA MSG-aao9 하드제약 ①②③④)
함수 본문 pg_get_functiondef 정적 검사:
- `canonical_inflow_channel_write` (SET inflow_channel=): **false** ✓ (② canonical 무접점)
- `self_reported_candidate_write` (SET inflow_channel_self_reported=): **true** ✓ (① candidate write)
- `first_inflow_channel` 등장: **COMMENT 라인 1건뿐** (실 write 없음) ✓ (③ customers.first_inflow_channel 무접점)
- `referral_source` write: **false** ✓ (④ verbatim 저장, 11코드 매핑/치환 0)
- customers UPDATE 블록 = `SET sms_opt_in = FALSE` 단 1건 (first_inflow_channel 무접점)

→ canonical inflow_channel NULL(pending) 유지 · candidate 컬럼에만 verbatim 착지 · referral_source freeze 무접점.

## 통지
apply 완료 → supervisor POST-APPLY 사후검증 대기 (E3 42703 미발생 / E1 실재 / candidate write E2E C그룹). supervisor status: deployed 전환 요망.
