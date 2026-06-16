# DB-Gate Evidence — T-20260616-foot-KOH-SPECIMENNO-FORMAT

검체번호 자동배정 포맷 핀(format pin). **테이블/컬럼/enum 무변경 — RPC body/시그니처만.**
data-architect ADDITIVE-GO(KOHTEST-LIFECYCLE) 스코프 내 포맷 핀 → 신규 DA CONSULT 불요.
대표 게이트 면제(autonomy §3.1). supervisor 단계 = DDL-diff 검토만.

## 확정 포맷 (총괄)
`K + YYMMDD(검체채취일 6자리) + '-' + 고객 폰 뒷4자리`   예: `K260616-1234`
중복 정책: 같은 날 폰뒷4 충돌 OK → UNIQUE/회피 로직 **없음**(공란없음이 목표).

## DDL diff (4점)

| # | 객체 | before | after |
|---|------|--------|-------|
| 1 | `next_koh_specimen_no` | `(uuid, date)` → `YYYYMMDD + 3자리seq`(advisory lock + count) | **DROP** 후 `(uuid, date, text)` → `'K'\|\|YYMMDD\|\|'-'\|\|폰뒷4` (IMMUTABLE, 테이블 무접근) |
| 2 | `publish_koh_result` | 검체번호 호출 주석(OFF), specimen_no=FE빈값 | 검체번호 호출 활성 + phone 뒷4 RPC내부 추출 + specimen_no override |
| 3 | (테이블) | — | **무변경** (form_submissions / customers / check_in_services 손대지 않음) |
| 4 | (enum/CHECK) | — | **무변경** |

- **콜러 회귀 0**: 旣 `next_koh_specimen_no(uuid,date)` 는 publish 에서 주석 처리(미호출) 상태였음 → DROP 안전.
- **phone PHI 비노출**: FE payload 확장 없음. `publish_koh_result` 내부에서 `customers.phone` 조회 → 숫자만 추출 우측4자리. FE 는 specimen_no 빈값 전달, RPC 가 override.
- **엣지 안전**: phone 미등록/4자리 미만 = `lpad(_,4,'0')` (`''`→`0000`, `123`→`0123`). 발행 차단 안 함(공란없음).

## 적용·검증 (dev-foot 직접, pg 연결)

```
✅ 마이그 실행 완료 (COMMIT, $verify$ 통과).
next_koh_specimen_no 시그니처: [ 'p_clinic uuid, p_base_date date, p_phone_last4 text' ]
포맷 샘플 (기대 K260616-1234): K260616-1234
publish_koh_result 검체번호 호출 활성: true
✅ 검증 통과 — 시그니처 교체 + 포맷 핀 + 호출 활성 확정.
```

- forward: `supabase/migrations/20260616180000_koh_specimen_no_format.sql`
- rollback: `supabase/migrations/20260616180000_koh_specimen_no_format.rollback.sql` (旣 LIFECYCLE-PUBLISH 상태 복원)
- apply script: `scripts/T-20260616-foot-KOH-SPECIMENNO-FORMAT_apply.mjs`

## E2E
`tests/e2e/T-20260616-foot-KOH-SPECIMENNO-FORMAT.spec.ts` — S1 정상삽입 / S2 같은날 폰뒷4 중복허용 / S3 phone 엣지 패딩 / S4 브라우저 스모크. (S1~S3 통과, S4 스모크.)

## 빌드
`npm run build` ✓ (4.31s)
