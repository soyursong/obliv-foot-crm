# T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED — merge-path DB-gate evidence (2/2)

- prod: rxlomoozakkjesdqjtvd
- 실행: 2026-06-11T05:04:32.763Z
- 출처: supervisor FIX-REQUEST MSG-20260611-115231-j2zr (phase1 db_migration_pending, ordered pair 2/2)
- 마이그: supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.sql
- 선행: 20260611100000_selfcheckin_personal_info_consolidate.sql (PASS, 동일 세션)

## [1] 사전 probe (적용 전) — fn_selfcheckin_rrn_match 정의
```
함수 정의 개수: 1
적용 전 privacy_consent 이관 라인: false
적용 전 sms_opt_in 이관 라인     : false
```

## [2] 마이그레이션 적용 (BEGIN/COMMIT 내장, CREATE OR REPLACE)
✅ 적용 완료 (에러 없음)
NOTIFY pgrst reload schema 전송

## [3] 사후 probe — fn_selfcheckin_rrn_match 정의 내 동의 이관 라인 검증
```
정의 내 set-list 발췌 (동의 이관):
  --    hira_consent/privacy_consent/sms_opt_in : src=true 우선(동의 다운그레이드 방지),
  hira_consent       = CASE WHEN src.hira_consent = true THEN true ELSE dest.hira_consent END,
  hira_consent_at    = CASE WHEN src.hira_consent = true AND dest.hira_consent IS DISTINCT FROM true
  THEN src.hira_consent_at
  ELSE dest.hira_consent_at
  privacy_consent    = CASE WHEN src.privacy_consent = true THEN true ELSE dest.privacy_consent END,
  privacy_consent_at = CASE WHEN src.privacy_consent = true AND dest.privacy_consent IS DISTINCT FROM true
  THEN src.privacy_consent_at
  ELSE dest.privacy_consent_at
  sms_opt_in         = CASE WHEN src.sms_opt_in = true THEN true ELSE dest.sms_opt_in END,
  sms_opt_in_at      = CASE WHEN src.sms_opt_in = true AND dest.sms_opt_in IS DISTINCT FROM true
  THEN src.sms_opt_in_at
  ELSE dest.sms_opt_in_at

PASS  privacy_consent 이관 라인
PASS  privacy_consent_at 이관 라인
PASS  sms_opt_in 이관 라인
PASS  sms_opt_in_at 이관 라인
PASS  customers.privacy_consent_at 컬럼
PASS  customers.sms_opt_in_at 컬럼
```

## [결과] db_gate_status = PASS ✅

- RPC replace only (set-list 확장). 신규 컬럼 없음(데이터계약 비변경). 백필 없음.
- rollback: supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.rollback.sql
