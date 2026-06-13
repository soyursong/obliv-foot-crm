# T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN — DB-gate evidence

- prod: rxlomoozakkjesdqjtvd
- 실행: 2026-06-13T15:33:31.420Z
- 마이그: supabase/migrations/20260613120000_customer_birthdate_derive_rpc.sql

## [1] 마이그레이션 적용 (BEGIN/COMMIT 내장, CREATE OR REPLACE)
✅ 적용 완료 (에러 없음)
NOTIFY pgrst reload schema 전송

## [2] 함수 정의 probe
```
함수 존재: true
SECURITY DEFINER: true
반환에 rrn 평문 누출 라인: false
```

## [3] 권한 probe — authenticated EXECUTE
```
  postgres: EXECUTE
  authenticated: EXECUTE
  service_role: EXECUTE
authenticated EXECUTE: true
PUBLIC EXECUTE (없어야 함): false
anon EXECUTE (PHI: 없어야 함): false
```

## [4] 호출 probe — 더미 입력(존재하지 않는 clinic/ids) → 0행, birth_date_display 컬럼만
```
반환 컬럼: birth_date_display,customer_id
반환 행수: 0 (더미 → 0 기대)
컬럼 = customer_id,birth_date_display 만: true
```

## [결과]
PASS  함수 존재
PASS  SECURITY DEFINER
PASS  rrn 평문 누출 라인 없음
PASS  authenticated EXECUTE 부여
PASS  PUBLIC EXECUTE 미부여
PASS  anon EXECUTE 미부여 (PHI)
PASS  반환 컬럼 = customer_id,birth_date_display
db_gate_status = PASS ✅

- read-only RPC. 신규 컬럼/테이블/enum 없음(데이터계약 비변경). 백필 없음.
- PHI: birth_date(YYYY-MM-DD)만 반환. rrn 평문/뒷자리/성별코드 미노출.
- rollback: supabase/migrations/20260613120000_customer_birthdate_derive_rpc.rollback.sql
