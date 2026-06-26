# T-20260625-foot-PASSPORT-PORT — DB-gate apply evidence (foot prod rxlomoozakkjesdqjtvd)
적용시각: 2026-06-26T01:56:22.441Z
supervisor GO: MSG-20260626-105431-di96 (DDL-DIFF-GO)

## [1] PRECHECK (적용 전 상태)
```json
{
  "nationalitiesExists": false,
  "natCount": null,
  "customerCols": {}
}
```

## [2] DRY-RUN (BEGIN → 마이그 실행 → ROLLBACK, prod 데이터 무변경)
  ✓ dry-run: nationalities 테이블 존재
  ✓ dry-run: nationalities >= 23행 (실제 23)
  ✓ dry-run: customers.nationality_id = bigint (실제 bigint)
  ✓ dry-run: customers.passport_first_name 존재
  ✓ dry-run: customers.passport_last_name 존재
  ✓ dry-run: customers.nationality_id 존재
  ✓ dry-run: customers.foreigner_registration_number 존재
  ✓ dry-run: customers.foreign_doc_expiry 존재
  ↩ ROLLBACK 완료 (dry-run 데이터 폐기)

## [3] REAL APPLY (마이그 자체 BEGIN/COMMIT)
  ✓ 마이그 COMMIT 완료 (검증 DO 블록 통과)

## [4] POSTCHECK (적용 후 상태)
```json
{
  "nationalitiesExists": true,
  "natCount": 23,
  "customerCols": {
    "nationality_id": "bigint",
    "foreign_doc_expiry": "date",
    "passport_first_name": "text",
    "passport_last_name": "text",
    "foreigner_registration_number": "text"
  }
}
```
  ✓ post: nationalities 테이블 존재
  ✓ post: nationalities >= 23행 (실제 23)
  ✓ post: customers.nationality_id = bigint
  ✓ post: customers.passport_first_name 존재
  ✓ post: customers.passport_last_name 존재
  ✓ post: customers.nationality_id 존재
  ✓ post: customers.foreigner_registration_number 존재
  ✓ post: customers.foreign_doc_expiry 존재


## 결과: ✓ PASS (적용 완료)
