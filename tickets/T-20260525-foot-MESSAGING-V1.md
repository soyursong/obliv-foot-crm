---
id: T-20260525-foot-MESSAGING-V1
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: true
e2e-spec: true
summary: "풋 CRM 메시징 모듈 1차 (롱레 복제) S1 완료. FIX-REQUEST 반영: SECTION1 clinic_messaging_capability 6컬럼 추가(solapi_api_key_vault_name/solapi_secret_vault_name/sender_number/send_start_hour/send_end_hour/kakao_channel_id), SECTION8 admin_save_messaging_config v2 교체(p_sender_number 파라미터+정규화+conditional UPSERT), SECTION9 solapi_validation_status CHECK 값 수정(unchecked/not_registered/api_unreachable), rollback.sql 함수 시그니처 갱신. 빌드 3.20s OK. DB변경: supabase/migrations/20260525030000_messaging_module.sql (미적용 — supervisor QA 시 적용)."
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
pending_scope: "S2 운영 데이터 등록(AC-4~7) — 김주연 승인 후 / S3 검증 발송(AC-11~12) — 검증 발송 GREEN 후"
qa_result: fail
qa_fail_phase: phase1
qa_fail_reason: db_schema_gap
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
