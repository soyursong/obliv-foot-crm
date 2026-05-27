---
id: T-20260525-foot-MESSAGING-V1
domain: foot
priority: P1
status: deployed
deploy-ready: false
build-passed: true
db-change: true
e2e-spec: true
summary: "풋 CRM 메시징 모듈 1차 (롱레 복제) S1 완료. FIX-REQUEST 3항목 반영(a06deb1 @5/25 18:21): SECTION1 clinic_messaging_capability 6컬럼 추가(solapi_api_key_vault_name/solapi_secret_vault_name/sender_number/send_start_hour/send_end_hour/kakao_channel_id), SECTION8 admin_save_messaging_config v2 교체(p_sender_number 파라미터+정규화+conditional UPSERT), SECTION9 solapi_validation_status CHECK 값 수정(unchecked/not_registered/api_unreachable), rollback.sql 함수 시그니처 갱신. 추가: 20260526220000_messaging_schema_align.sql — notification_templates(template→body, active→is_active, channel CHECK), notification_logs(provider_msg_id→solapi_message_id, body_rendered/error_code 추가, status/channel CHECK 정렬). 빌드 3.50s OK. DB변경: 2개 migration 미적용 — supervisor QA 시 적용."
hotfix: false
created: 2026-05-25 16:22
deadline: 2026-05-28
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
reporter: 김승현 대표
reporter_slack_id: U07DXQXF12N
attachments: []
e2e_spec_exempt_reason:
risk_verdict: GO_WARN
risk_reason: "3/5 — DB 스키마 신규 5테이블(messaging), EF 신규(send-notification), 셀프체크인 고객 데이터 쓰기 경로 변경(sms_opt_in 추가)"
deploy_scope: S1_code_copy
pending_scope: "S3 검증 발송(AC-11~12) — 검증 발송 GREEN 후"
s2_completed_at: "2026-05-27T15:20:00+09:00"
s2_commit: "50e84f4"
s2_summary: "AC-4 vault 7건(supabase_project_url/anon_key/internal_cron_secret/종로API+Secret/송도API+Secret). AC-5 clinic_messaging_capability 종로(01088277791)+송도(01034573344) enabled=true. AC-6 pg_cron 4건 active(D-1/morning/retry/keep-warm) — Supabase 제약으로 morning/retry active=FALSE 불가, 플래너 FOLLOWUP 발신. AC-7 버그수정: notify_reservation_messaging+notify_reminders_batch status reserved→confirmed. EF INTERNAL_CRON_SECRET 등록. dry-run: d1 skipped=1, retry retried=0."
s2_cron_note: "⚠ morning(foot-notif-reminder-morning)+retry(foot-notif-retry-failed) active=TRUE — Supabase 제약(cron.job UPDATE permission denied). 의도는 비활성이었으나 기술 제약. Supabase Dashboard에서 수동 비활성화 또는 S3에서 처리 필요."
qa_result: pass
qa_grade: Yellow
qa_fail_phase: ""
qa_fail_reason: ""
qa_fix_commit: "c2b4075"
qa_fix_note: "FIX-REQUEST 재QA: rollback.sql STEP1 cron.job 직접쿼리→DO블록4개 수정. forward migration CHECKLIST 4번 2개→2개 행 수정. 재QA 요청."
qa_checked_at: "2026-05-27T14:35:00+09:00"
spec_fix_at: "2026-05-27T14:45:00+09:00"
spec_fix_commit: "f50f1db7b1df8b898769769e30f0c75852620edc"
deployed_at: "2026-05-27T14:35:27+09:00"
deploy_commit: "f50f1db7b1df8b898769769e30f0c75852620edc"
bundle_hash: "5a6e59f7c1e8a5de96f44788ea52d01d"
field_soak_until: "2026-05-28T14:35:00+09:00"
status: deployed
deploy-ready: false
---

## QA 결과 (supervisor 재QA — 2026-05-27 commit 10f18b1)

### QA 게이트 요약

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| 1 | 빌드 | ✅ PASS | 3.44s exit 0 |
| 2 | 기존 기능 | ✅ PASS | 신규 기능 추가. 기존 체크인→결제 동선 무영향 |
| 3 | DB 호환 | ❌ FAIL | **rollback.sql STEP 1 cron.job 직접 쿼리 — 권한 문제** (상세 아래) |
| 4 | 권한·RLS | ✅ WARN | AC-8 메뉴 노출 deviation (타 티켓 ROLE-PERM-CUSTOM, 페이지 가드 OK) |
| 5 | 모바일 | ✅ PASS | hidden md:flex 사이드바 + 상단 탭 정상 |
| 6 | env 매트릭스 | ✅ PASS | 신규 import.meta.env 없음. 기존 VITE_ 변수 활용 |
| 7 | Runtime Safety | ✅ PASS | 배열 `?? []` 가드 전수, EF null 체크 정상 |
| FIX-1 확인 | SECTION1 컬럼 정렬 | ✅ VERIFIED | schema_align migration(20260526220000) 정상 — body/is_active/solapi_message_id/body_rendered/error_code UI+EF 일치 |
| FIX-2 확인 | SECTION8 v2 반영 | ✅ VERIFIED | admin_save_messaging_config FINAL v2 시그니처+본문 정상 |
| FIX-3 확인 | SECTION9 DO블록 | ✅ VERIFIED | cron.unschedule DO$$...EXCEPTION WHEN OTHERS THEN NULL 패턴 적용 확인 |

### ❌ NO-GO 사유: rollback SQL 파손

**파일**: `supabase/migrations/20260525030000_messaging_module.rollback.sql` STEP 1

**문제**:
```sql
-- STEP 1 (현재 — 파손)
SELECT cron.unschedule(jobname)
  FROM cron.job                              -- ← cron.job 직접 쿼리
 WHERE jobname IN ('foot-notif-reminder-d1', ...);
```

**근거**: 동일 파일 `20260525030000_messaging_module.sql` SECTION 15-A 주석:
> `cron.job 직접 쿼리 권한 없음 → DO 블록으로 처리`

forward migration이 명시적으로 피한 패턴이 rollback에 그대로 남아 있음.  
rollback 실행 시 STEP 1에서 permission denied → BEGIN/COMMIT 트랜잭션 전체 실패 → 롤백 불가능.

**수정 방법** (1개 항목):
```sql
-- STEP 1 (수정 후)
DO $$ BEGIN PERFORM cron.unschedule('foot-notif-reminder-d1'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('foot-notif-reminder-morning'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('foot-notif-retry-failed'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('foot-ef-send-notification-keep-warm'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
```

**추가 수정 권장** (2번째, non-blocking):  
`20260525030000_messaging_module.sql` POST-DEPLOY CHECKLIST 4번 항목: 실제 등록 cron은 2개(d1, keep-warm)이나 체크리스트는 4개(morning/retry active=FALSE 포함) 언급 → 2개로 수정 또는 "morning/retry는 S2 마이그에서 별도 등록" 주석 추가

수정 후 `deploy-ready: true` 재마킹 + supervisor 재QA 요청.

---

# T-20260525-foot-MESSAGING-V1 — 풋 CRM 메시징 모듈 1차 (롱레 복제)

## 배경

롱레 검증된 메시징 모듈(SMS D-1 리마인드)을 풋(obliv-foot-crm)에 0% 변경 복제.
- 출처: T-20260520-crm-MESSAGING-SMS-V1 + T-20260522-crm-MESSAGING-AUTOSEND (deployed)

## S1 완료 항목 (코드 복제, 즉시 착수 가능)

### DB 마이그레이션 (미적용 — supervisor QA 시 적용)
- `supabase/migrations/20260525030000_messaging_module.sql` (900줄)
- `supabase/migrations/20260525030000_messaging_module.rollback.sql` (롤백)

### Edge Function
- `supabase/functions/send-notification/index.ts` — 솔라피 SMS 발송 (롱레 복제)

### FE 코드
- `src/pages/AdminSettings.tsx`
- `src/components/AdminLayout.tsx`
- `src/lib/permissions.ts`
- `src/App.tsx`
- `src/pages/SelfCheckIn.tsx`

## S2 대기 항목 (김주연 승인 후)
- clinic_messaging_capability INSERT (풋 지점별)
- Vault 4건
- 발신번호 등록

## S3 대기 항목 (S2 완료 후)
- 검증 발송, D-1 cron active 전환

---

## QA 결과 (supervisor — 2026-05-25)

### Phase 1: 코드 QA

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | 3.67s, exit 0 |
| 기존 기능 영향 | ✅ PASS | 신규 테이블/컬럼만 추가. 기존 reservations 트리거에 신규 trigger 추가되나 EXCEPTION 처리 있어 기존 INSERT 영향 없음 |
| DB 호환성 | ❌ FAIL | 스키마 갭 — 상세 아래 |
| 권한/RLS | ✅ PASS | 4테이블 RLS 정책 정상. SECURITY DEFINER RPC admin-only 체크 확인 |
| 롤백 SQL | ✅ PASS | rollback.sql 존재, 역순 DROP 확인 |

### Phase 1.5: 빌드 env 매트릭스

| 변수 | 신규 여부 | 판정 |
|------|----------|------|
| `VITE_SUPABASE_URL` | 기존 | ✅ |
| `VITE_SUPABASE_ANON_KEY` | 기존 | ✅ |
| (EF env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_CRON_SECRET`) | Supabase secret 관리 | ✅ |

메시징 모듈은 FE에서 새로운 `import.meta.env.*` 변수를 추가하지 않음. Phase 1.5 PASS.

### Phase 7.5: Runtime Safety Gate

- `Object.values()` / `for-of` 직접 접근 패턴: 없음
- 배열 초기화: `(data as NotificationTemplate[]) ?? []` 패턴 전수 사용 ✅
- optional chaining: `capability?.sender_number ?? ''` 등 일관 적용 ✅
- Runtime Safety Gate PASS

---

## ❌ NO-GO 사유: DB 스키마 갭

### 이슈 1 (CRITICAL) — `clinic_messaging_capability` 컬럼 누락

**근거**: `happy-flow-queue/supabase/migrations/20260521230000_messaging_module.sql` 86~93줄 vs 풋 SECTION 1 비교.

CRM 원본 `clinic_messaging_capability` 테이블 실제 컬럼:
```sql
solapi_api_key_vault_name  TEXT,         -- Vault key name
sender_number              TEXT,         -- 발신번호
send_start_hour            SMALLINT NOT NULL DEFAULT 9  CHECK (BETWEEN 0 AND 23),
send_end_hour              SMALLINT NOT NULL DEFAULT 21 CHECK (BETWEEN 0 AND 23),
kakao_channel_id           TEXT,
```

풋 마이그레이션 SECTION 1은 `id, clinic_id, enabled, created_at, updated_at` 5개 컬럼만 생성. 위 5개 컬럼 **전부 누락**.

**영향**:
- `capability?.sender_number` → `undefined` (DB 컬럼 없음) → UI 발신번호 항상 미등록 표시
- `capability?.solapi_api_key_vault_name` → `undefined` → API 자격증명 없음 표시 (저장 후에도)
- `hasKey` / `hasSender` 항상 `false` → 채널 상태 항상 미설정

### 이슈 2 (CRITICAL) — `admin_save_messaging_config` 파라미터 불일치

**근거**: 풋 SECTION 8 함수 시그니처 vs `happy-flow-queue/migrations/20260523100000_admin_save_messaging_config_v2.sql` 비교.

풋 SECTION 8 (현재):
```sql
CREATE OR REPLACE FUNCTION public.admin_save_messaging_config(
  p_clinic_id  UUID,
  p_api_key    TEXT,
  p_api_secret TEXT,
  p_enabled    BOOLEAN DEFAULT TRUE
)
```

CRM v2 (정상):
```sql
CREATE OR REPLACE FUNCTION public.admin_save_messaging_config(
  p_clinic_id     UUID,
  p_sender_number TEXT    DEFAULT NULL,
  p_enabled       BOOLEAN DEFAULT NULL,
  p_api_key       TEXT    DEFAULT NULL,
  p_api_secret    TEXT    DEFAULT NULL
)
```

FE 호출 코드 (`AdminSettings.tsx` L412~418):
```typescript
supabase.rpc('admin_save_messaging_config', {
  p_clinic_id:     clinicId,
  p_sender_number: senderNumber.trim() || null,   ← 이 파라미터 없음
  p_enabled:       enabled,
  p_api_key:       apiKey.trim() || null,
  p_api_secret:    apiSecret.trim() || null,
});
```

PostgreSQL은 named parameter 불일치 시 `ERROR: 42883 function does not exist` 반환.
**저장 버튼 100% 실패** (toast.error로 잡히나 기능 불동작).

### 이슈 3 (MINOR) — `solapi_validation_status` CHECK 값 불일치

DB CHECK: `('none','pending','verified','failed')`  
TS type: `'unchecked' | 'pending' | 'verified' | 'not_registered' | 'api_unreachable' | null`

DB에서 `'none'` 반환 시 `SenderValidationBadge`가 미매핑 값으로 렌더링됨. 기능 영향 최소 (fallback 처리되면 OK)이나, 값 일치 권장.

---

## 수정 요청 (dev-foot)

1. **`20260525030000_messaging_module.sql` SECTION 1 수정**: `clinic_messaging_capability` CREATE TABLE에 누락 컬럼 추가
   ```sql
   solapi_api_key_vault_name  TEXT,
   sender_number              TEXT,
   send_start_hour            SMALLINT NOT NULL DEFAULT 9  CHECK (send_start_hour BETWEEN 0 AND 23),
   send_end_hour              SMALLINT NOT NULL DEFAULT 21 CHECK (send_end_hour BETWEEN 0 AND 23),
   kakao_channel_id           TEXT,
   ```

2. **SECTION 8 `admin_save_messaging_config` 함수 교체**: CRM v2 (`20260523100000_admin_save_messaging_config_v2.sql`) 시그니처 + 본문으로 대체.
   - `p_sender_number TEXT DEFAULT NULL` 파라미터 추가
   - `sender_number` upsert 로직 포함
   - `p_enabled BOOLEAN DEFAULT NULL` (NULL = 기존값 유지) 적용

3. **SECTION 9 CHECK constraint 값 수정** (MINOR):  
   `'none'` → `'unchecked'`, `'failed'` → `'not_registered'` 또는 FE TS type에 맞게 통일

4. **rollback.sql 수정**: 컬럼 추가에 대응하는 DROP COLUMN 보완 (현재 `sms_opt_in` DROP만 있음)

수정 후 `deploy-ready: true` 재마킹, supervisor QA 재요청.
