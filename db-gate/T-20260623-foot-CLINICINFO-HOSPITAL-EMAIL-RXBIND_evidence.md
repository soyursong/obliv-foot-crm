# T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND — DB-gate evidence
- db: rxlomoozakkjesdqjtvd | 2026-06-23T04:45:15.859Z | mode: AUDIT+APPLY
- DA GO: CONSULT-REPLY MSG-20260623-134112-a9fu (ADDITIVE 확정·신규컬럼 email)

## [A] read-only audit (pre)
```
clinics.email 컬럼(적용 전): 없음(신설 대상)
```

## [B] ADD COLUMN apply (20260623160000)
✅ ALTER TABLE clinics ADD COLUMN IF NOT EXISTS email TEXT (+COMMENT) 적용 완료

## [C] NOTIFY pgrst 'reload schema' 전송

## [D] post-verify
```
컬럼 메타(적용 후): {"column_name":"email","data_type":"text","is_nullable":"YES","column_default":null}
```

## [결과] PASS ✅
- 컬럼 메타 text/YES/null: OK
- 롤백: ALTER TABLE clinics DROP COLUMN IF EXISTS email;
