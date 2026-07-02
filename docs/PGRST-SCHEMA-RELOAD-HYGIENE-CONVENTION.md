# PostgREST 스키마캐시 리로드 위생 컨벤션 (foot lane)

- **status**: active
- **adopted**: 2026-07-03 (IMPROVE-ACK → DA-20260703-PGRST-RELOAD-HYGIENE)
- **source**: cross_crm_data_contract.md §23 (v1.37) — cross-product 재발 이슈 성문 표준
- **scope**: obliv-foot-crm `supabase/migrations/**` 신규 마이그레이션
- **backfill**: no-op (기존 741개 마이그 소급 금지. 현재 REST 200 서빙 중이면 불요)

## 왜 (실패모드)

out-of-band DDL(대시보드 SQL editor·직접 psql 등) 이후 PostgREST 스키마캐시가 stale 상태로 남으면,
테이블/컬럼/RPC가 **물리적으로 실재하고 RLS/GRANT가 정상**이어도 anon REST가 `404`(또는 PGRST204/205/202)를 낸다.
→ obliv-body-crm `questionnaire_questions` 6/30~7/2 anon REST 404 창(introspection_body_questionnaire_404.md)이 이 실패모드.

foot lane도 최근 스키마변경 마이그(chart_treatment_requests / therapist_capabilities / pkg_triple_defect_transfer_deduct)에
NOTIFY가 누락되어 동일 노출. 본 컨벤션으로 재발 창을 구조적으로 차단한다.

## 규칙 (신규 마이그부터)

### ① 스키마변경 마이그 말미에 리로드 1줄
신규 **테이블/컬럼/RPC/VIEW/enum·CHECK 교체** 등 스키마 표면을 바꾸는 마이그의 **말미**에 다음 1줄을 넣는다.
idempotent·부작용 0.

```sql
NOTIFY pgrst, 'reload schema';
```

### ② 원자 DROP+ADD은 동일 트랜잭션 내 NOTIFY
enum/CHECK 교체처럼 DROP + ADD를 원자적으로 해야 하면 **같은 트랜잭션(BEGIN/COMMIT) 안**에서 처리하고,
COMMIT 직전에 `NOTIFY pgrst, 'reload schema';`.

```sql
BEGIN;
  ALTER TABLE foo DROP CONSTRAINT foo_status_check;
  ALTER TABLE foo ADD  CONSTRAINT foo_status_check CHECK (status IN ('a','b','c'));
  NOTIFY pgrst, 'reload schema';
COMMIT;
```

### ③ 가능하면 supabase db push 경로 병행
`supabase db push` 경로는 DDL 이벤트 트리거로 스키마 리로드가 자동 트리거된다. 가능하면 이 경로를 쓴다.
(대시보드/직접 psql로 out-of-band 적용하면 자동 리로드가 안 걸려 stale 위험.)

### ④ 적용 후 REST 1회 SELECT 200 검증 (hotfix·prod 직적용 시 필수)
마이그 적용 직후 대상 객체를 REST로 1회 SELECT 해 **200**을 확인한다. 404/PGRST20x면 리로드 미반영 → NOTIFY 재발행.

```bash
# 예: 신규 테이블 foo가 anon REST로 200 서빙되는지
curl -sS -o /dev/null -w '%{http_code}\n' \
  "$SUPABASE_URL/rest/v1/foo?select=id&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# 기대: 200
```

## 체크리스트 (스키마변경 마이그 작성 시)

- [ ] 스키마 표면 변경(테이블/컬럼/RPC/VIEW/enum·CHECK)이면 말미에 `NOTIFY pgrst, 'reload schema';` 있는가
- [ ] 원자 DROP+ADD이면 동일 BEGIN/COMMIT 트랜잭션 안에서 NOTIFY 했는가
- [ ] hotfix/prod 직적용이면 적용 후 대상 객체 REST SELECT 200 확인했는가
- [ ] DDL 동반 구현이면 §S2.4 데이터 정책 자문(CONSULT) 선행했는가 (신규 컬럼/테이블/enum/CHECK 추가 시)

## 경계

- **순수 데이터 마이그(INSERT/UPDATE seed, RLS 정책만 교체)**: 스키마 표면 무변경이면 NOTIFY 불필요(무해하므로 넣어도 됨).
- **backfill**: 기존 마이그 소급 수정 금지. 현재 REST 200 서빙이면 손대지 않는다.
- **DDL 동반**: 본 컨벤션은 리로드 위생만 다룬다. 실제 DDL(신규 컬럼/테이블/enum)은 §S2.4 data-architect 자문 게이트 선행이 별도로 필요.
