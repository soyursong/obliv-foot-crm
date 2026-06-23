# T-20260623-foot-CHART2-CUSTMEMO-RENAME-ADD — DB-gate evidence
- db: rxlomoozakkjesdqjtvd | 2026-06-23T12:16:24.593Z | mode: AUDIT+APPLY
- ADDITIVE nullable 신규컬럼 customers.customer_note (autonomy §3.1 대표게이트 면제·supervisor DDL-diff만)

## [A] read-only audit (pre)
```
customers.customer_note 컬럼(적용 전): 없음(신설 대상)
```

## [B] ADD COLUMN apply (20260623170000)
✅ ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_note TEXT (+COMMENT) 적용 완료

## [C] NOTIFY pgrst 'reload schema' 전송

## [D] post-verify
```
컬럼 메타(적용 후): {"column_name":"customer_note","data_type":"text","is_nullable":"YES","column_default":null}
```

## [결과] PASS ✅
- 컬럼 메타 text/YES/null: OK
- 롤백: ALTER TABLE customers DROP COLUMN IF EXISTS customer_note;
