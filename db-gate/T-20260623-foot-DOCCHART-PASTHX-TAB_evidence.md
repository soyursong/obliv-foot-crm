# T-20260623-foot-DOCCHART-PASTHX-TAB — DB-gate evidence
- db: rxlomoozakkjesdqjtvd | 2026-06-23T18:40:44.309Z | mode: AUDIT+APPLY
- ADDITIVE 신규테이블 patient_past_history (autonomy §3.1 대표게이트 면제·supervisor DDL-diff만, DA GO MSG-fqrs)

## [A] read-only audit (pre)
```
patient_past_history 테이블(적용 전): 없음(신설 대상)
```

## [B] CREATE TABLE apply (20260623180000)
✅ CREATE TABLE IF NOT EXISTS patient_past_history + indexes + RLS + 3 policies 적용 완료

## [C] NOTIFY pgrst 'reload schema' 전송

## [D] post-verify
```
컬럼:
  id | uuid | nullable=NO
  clinic_id | uuid | nullable=NO
  customer_id | uuid | nullable=NO
  lines | jsonb | nullable=NO
  comment | text | nullable=YES
  confirmed_by | uuid | nullable=YES
  confirmed_at | timestamp with time zone | nullable=NO
RLS enabled: true
정책:
  clinic_isolation_pph_insert (a)
  clinic_isolation_pph_select (r)
  own_delete_pph (d)
인덱스:
  idx_pph_clinic
  idx_pph_customer
  patient_past_history_pkey
```

## [결과] PASS ✅
- 컬럼 7종: OK
- RLS enabled: OK
- 정책 ≥3: OK (3)
- 인덱스 idx_pph_customer/idx_pph_clinic: OK
- 롤백: 20260623180000_patient_past_history.rollback.sql (DROP TABLE IF EXISTS patient_past_history;)
