# DB-Gate 이관 — T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST

> **to**: supervisor (DB 게이트) · **from**: dev-foot · **db_change**: YES
> **priority**: P2 · **deadline**: 2026-06-13 · **risk_verdict**: GO_WARN
> **data-architect CONSULT**: 신규 컬럼/테이블/enum 추가 **없음** (기존 제약 재정의만) → §S2.4 데이터 정책 자문 게이트 **비해당**. cross_crm 계약·도파민 push 무변경.

## 무엇을 적용하나
`package_sessions` 의 UNIQUE 제약을 재설계:
- DROP `unique_package_checkin UNIQUE (package_id, check_in_id)`
- ADD `unique_package_checkin_session UNIQUE (package_id, check_in_id, session_number)`

- forward: `supabase/migrations/20260611230000_deduct_dupkey_checkin_session.sql`
- rollback: `supabase/migrations/20260611230000_deduct_dupkey_checkin_session.rollback.sql`

## 왜 (근거)
ⓠ1=B 확정(김주연 총괄 2026-06-11 "웅 있음!!!!"): **같은 날(같은 내원) 같은 패키지 2회+ 차감**이 실제 동선.
구 제약 `(package_id, check_in_id)` 이 정당한 2회차 차감을 23505로 막아 현장 토스트 오류(스크린샷 F0B9Q2DAUMC, F0B9CFSLTGX). 지정치료사 유무와 무관하게 재현됨(실측 2건).

## 안전 설계 (검수 포인트)
1. **기존 행 무효화 0**: 제약 교체만 — 데이터 재작성·삭제·backfill 없음.
2. **오차감 가드 유지**: 새 복합 unique 가 동일 `(package_id, check_in_id, session_number)` 재INSERT(이중 클릭)는 여전히 차단.
3. **NULL check_in 보존**: `check_in_id IS NULL`(차감일≠내원일) 행은 PG NULL distinct → 구·신 제약 모두 미적용, 동작 동일.
4. **FE 정합**: 차감 전 precheck(`findSameCheckinSession`)로 같은 내원 이력 감지 시 3-way 모달(① 치료사만 변경 UPDATE / ② 1회차 추가 차감 INSERT / ③ 취소). 잔존 23505 는 graceful 토스트로 흡수(AC3).
   - ⚠ **순서 주의**: 마이그 prod 적용 **전**에는 ② 추가 차감 INSERT 가 구 제약에 막혀 23505 → FE 가 graceful 안내("아직 반영 안 됨")로 흡수하므로 raw 오류는 안 뜨나, ② 기능은 **마이그 적용 후** 동작. ① 치료사만 변경(UPDATE)은 마이그 무관하게 즉시 동작. **권장: FE 배포와 마이그를 같은 윈도에 적용.**

## ⚠ 롤백 한계 (ONE-WAY 주의)
멀티 차감(같은 `package_id`·`check_in_id`·다른 `session_number`) 행이 1건이라도 생성된 뒤에는 롤백의 `ADD CONSTRAINT unique_package_checkin (package_id, check_in_id)` 가 중복행으로 **실패** → 사실상 one-way.
- 롤백 전 점검 쿼리(rollback.sql 주석에도 포함):
  ```sql
  SELECT package_id, check_in_id, count(*)
    FROM package_sessions WHERE check_in_id IS NOT NULL
    GROUP BY package_id, check_in_id HAVING count(*) > 1;
  ```
  결과가 1행이라도 있으면 원 제약 재부착 불가 → escape hatch = 복합 unique 유지.
- supervisor 가 **롤백 윈도(멀티 차감 발생 전)** 를 배포 노트에 명시 권고.

## 적용 절차 (권고)
1. dry-run: 트랜잭션 내 DROP+ADD → `\d package_sessions` 로 신 제약 확인 → ROLLBACK (prod 무변경 확인)
2. forward 적용 → `unique_package_checkin_session` 존재 + 구 `unique_package_checkin` 제거 확인
3. FE(이 커밋) 배포와 동일 윈도 적용 — ② 추가차감 동작 정합
4. 검증: 같은 고객·같은 내원·같은 패키지로 (a) 1차 차감 OK → (b) 재차감 시 3-way 모달 → ① 담당만 변경=회차 1건 유지 / ② 추가 차감=2회차 생성·잔여 1 감소 / ③ 취소=무변경. raw "duplicate key" 토스트 0건 확인.

## 회귀 가드
- 정상 첫 차감 / check_in_id 귀속(T-20260609) / 잔여 집계 / 힐러 예약後 차감 / 지정치료사 유무 무관 동작 — E2E 박제 5케이스 통과(`tests/e2e/T-20260611-foot-DEDUCT-DUPKEY-SUBTHERAPIST.spec.ts`).
- `package_sessions` 컬럼 스키마 **무변경**(제약만 교체).
