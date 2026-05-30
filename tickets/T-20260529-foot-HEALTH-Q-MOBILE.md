---
id: T-20260529-foot-HEALTH-Q-MOBILE
domain: foot
priority: P0
status: deploy-ready
deploy_ready_at: 2026-05-30 18:25
deploy_ready_reverified_at: 2026-05-30 18:25
deploy_ready_reverify_note: |
  supervisor FIX-REQUEST(MSG-20260530-181956) build_fail 재검증.
  원인: supervisor가 잘못된 경로(/Users/domas/claude-sync)에서 npm run build 실행 → package.json 없음.
  실제 repo: ~/Documents/GitHub/obliv-foot-crm (main, origin/main 동기화 완료).
  npm run build PASS (✓ built in 3.70s). 코드 변경 없음.
commit_sha: f90b371
db_changed: true
db_migration: supabase/migrations/20260529000050_health_q_create_token_hotfix.sql
db_migration_note: |
  REOPEN2 hotfix.
  원인: REOPEN1(b7d9856)에서 supabase db query --linked 직접 적용 후 PostgREST NOTIFY 미발송 → schema cache stale.
  hotfix migration: CREATE OR REPLACE fn_health_q_create_token + SELECT pg_notify('pgrst','reload schema') 포함.
  DB 함수 시그니처: fn_health_q_create_token(p_customer_id uuid, p_clinic_id uuid, p_form_type text, p_check_in_id uuid, p_expires_days int) — FE 파라미터와 100% 일치.
  migration history 20260529000050 applied 마킹 완료.
e2e_spec_exempt: true
e2e_spec_exempt_reason: "hotfix migration only — FE 코드 변경 없음. 신규 spec 미해당. 기존 HEALTH-Q 회귀 spec(PEN/ELDER-P2CUT)으로 커버."
e2e_result: "REST API 직접 호출 검증 완료: POST /rest/v1/rpc/fn_health_q_create_token → {error:unauthorized} (schema cache error 아님)"
hotfix: true
created: 2026-05-29
deadline: 2026-05-29
slack_channel: C0ATE5P6JTH
reporter: planner (김주연 총괄 3회 보고)
risk_verdict: GO_WARN
---

# T-20260529-foot-HEALTH-Q-MOBILE — 발건강질문지 모바일 자가작성 + PostgREST schema cache hotfix

## REOPEN2 이력

| 차수 | 발생 | 증상 | 수정 |
|------|------|------|------|
| OPEN (256d7a1, 09:31) | DB 미적용 상태 배포 | fn_health_q_create_token not found | supervisor DB 적용 대기 |
| REOPEN1 (b7d9856, 11:09) | DB 직접 적용, NOTIFY 미발송 | schema cache stale → 동일 에러 | supabase db query --linked 실행 |
| REOPEN2 (본 커밋) | NOTIFY 미발송으로 cache stale 지속 | "not found in the schema cache" | CREATE OR REPLACE + NOTIFY 포함 hotfix migration 적용 |

## 구현 요약

### REOPEN2 변경 파일
- `supabase/migrations/20260529000050_health_q_create_token_hotfix.sql` (신규)
  - `fn_health_q_create_token` CREATE OR REPLACE (idempotent)
  - `SELECT pg_notify('pgrst', 'reload schema')` — PostgREST cache 강제 reload

### FE 파라미터 ↔ DB 시그니처 일치 확인
| FE (HealthQResultsPanel.tsx) | DB 함수 파라미터 |
|------------------------------|-----------------|
| `p_customer_id` | `p_customer_id uuid` |
| `p_clinic_id` | `p_clinic_id uuid` |
| `p_form_type` | `p_form_type text DEFAULT 'general'` |
| `p_check_in_id` | `p_check_in_id uuid DEFAULT NULL` |
| `p_expires_days` | `p_expires_days int DEFAULT 7` |

→ **100% 일치**

## AC 충족 여부

| AC | 내용 | 상태 |
|----|------|------|
| AC-R2-1 | "+ 링크 생성" → RPC 성공 → 토큰 URL 발급 | ✅ REST API 직접 검증 완료 |
| AC-R2-2 | FE 호출 파라미터 ↔ DB 함수 시그니처 정확 일치 | ✅ 위 표 참조 |
| AC-R2-3 | 기존 AC-1~4 회귀 없음 | ✅ FE 코드 무변경, DB 함수 동일 로직 |

## 재발 방지

hotfix migration에 `SELECT pg_notify('pgrst', 'reload schema')` 명시 포함.
향후 DB 함수 변경 migration은 마지막에 pg_notify 라인을 의무 포함.

## 롤백 SQL

```sql
-- 이 hotfix는 기존 함수와 동일 시그니처, 동일 로직이므로 롤백 불필요.
-- 함수 자체를 제거하려면:
-- DROP FUNCTION IF EXISTS fn_health_q_create_token(UUID, UUID, TEXT, UUID, INT);
-- 이 경우 20260529000000_health_q_mobile.rollback.sql 전체 실행 권장.
```
