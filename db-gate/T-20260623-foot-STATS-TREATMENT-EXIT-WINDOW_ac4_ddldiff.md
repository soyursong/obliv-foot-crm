# T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW — AC4 DDL-diff 패키지 (supervisor용)

- **목적**: supervisor가 PROD 적용 전 DDL-diff + 2PHANTOM lineage(designated·roster·laser→treatment-exit·정밀매칭) 회귀0 확인.
- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
- **마이그**: `20260623130000_foot_therapist_stats_treatment_exit_window.sql.GATE_HOLD` (AC4+AC5 통과 후 `.GATE_HOLD` 제거 → 정상 .sql 커밋)
- **베이스(LIVE)**: summary=`20260623120000`(roster·designated 10컬럼), services=`20260622120000`(roster×4종 grid 6컬럼)
- **product 근거**: 김주연 총괄 B confirm MSG-20260623-082814-wrfs (치료실 퇴실 기준)
- **DA 사전 GO**: DA-20260623-FOOT-TREATTIME-WINDOW / CONSULT-REPLY MSG-20260623-032609-hs8z (recompute 경로, KPI SSOT §8B)

---

## 1. 변경 범위 한 눈에

| 구분 | 변경 | 비고 |
|------|------|------|
| 테이블 스키마 | **0건** | 컬럼/타입/제약/enum 무변경 |
| RPC `foot_stats_therapist_summary` | CREATE OR REPLACE (시그니처 불변) | 10컬럼 그대로 → DROP 불요 |
| RPC `foot_stats_therapist_services` | CREATE OR REPLACE (시그니처 불변) | 6컬럼 그대로 → DROP 불요 |
| 인덱스 | +1 additive (`CREATE INDEX IF NOT EXISTS`) | 비파괴, 종료조건 탐색용 |
| 데이터(row) | **0건 변경** | STABLE 함수 = 조회 시 재계산. backfill/배치 없음 |
| 산출 수치 | 이동 있음 (평균치료시간↑) | AC5 사전고지 대상 |

## 2. 기능적 DDL 차이 — 두 RPC 모두 "한 줄"

측정창 **종료조건만** 정정. 시작(`to_status='preconditioning'` 진입)·반환형·roster·designated·정밀매칭 fallback·체험전환율 전부 LIVE 그대로.

```diff
  JOIN LATERAL (
    SELECT
      MIN(st.transitioned_at) FILTER (WHERE st.to_status   = 'preconditioning') AS start_at,
-     MIN(st.transitioned_at) FILTER (WHERE st.to_status   = 'laser')           AS end_at
+     MIN(st.transitioned_at) FILTER (WHERE st.from_status = 'preconditioning') AS end_at
    FROM status_transitions st
    WHERE st.check_in_id = b.id
  ) w ON TRUE
```

- 의미: 종료 = "레이저실 진입" → "치료실 슬롯을 떠나는 최초 전이"(목적지 무관: laser/done/healer_waiting/laser_waiting 등).
- **room_id 비참조**: 종료점이 status 전이값 기반 → room_id 적재율 0%와 무관(DA 사전 GO 핵심 조건).
- summary·services **동일 측정창 공유** → split-brain 없음.

그 외 diff는 전부 비기능(주석·COMMENT 문구·summary는 `CREATE`→`CREATE OR REPLACE` 키워드 전환뿐).

## 3. ★ 2PHANTOM 회귀0 lineage 보존 증명

원형 phantom `20260612130000_..._treatment_exit`(roster 이전 정의)를 **재적용하지 않음**. 현 LIVE 정의 위에 종료 한 줄만 surgical 정정.

| lineage 요소 | 상태 | dry-run 검증 |
|--------------|------|-------------|
| roster anchor (staff role='therapist' AND active) | 보존 | base/cat JOIN roster 그대로 |
| designated 산식 (옵션B, customers.designated_therapist_id == check_ins.therapist_id) | 보존 | desig **12/168 불변** |
| 정밀매칭 (check_in_id 우선 + 근사 fallback) | 보존 | linked 로직 그대로 |
| 체험전환율 / IV 제외 | 보존 | exp_agg 그대로 |
| 반환 시그니처 (summary 10컬럼 / services 6컬럼) | 보존 | pg_get_function_result 동일 |

## 4. dry-run 실측 (BEGIN→apply→ROLLBACK, PROD 쓰기 0건)

실측 시각 2026-06-23 (product B confirm 후 재검증), 전 클리닉 2026-01-01~today:

| 단계 | summary treat | summary avg_min | designated | services rows | services linked | integ_bad |
|------|--------------|-----------------|-----------|--------------|-----------------|-----------|
| 적용 전 (laser-end LIVE) | 11 | 9.9 | 12/168 | 44 | 11 | 0 |
| dry-run (치료실퇴실) | 14 | 43.9 | 12/168 | 44 | 14 | 0 |
| 롤백 후 (laser-end 원복) | 11 | 9.9 | 12/168 | 44 | 11 | 0 |

- ✅ 시그니처 불변, ✅ designated 12/168 불변(2PHANTOM 회귀0), ✅ services grid 44행 불변, ✅ integ_bad=0 (designated_count ≤ total_checkin_count 전행), ✅ ROLLBACK 후 정확 원복(rollback.sql 신뢰).
- 숫자 이동: treatment_count +3(11→14), 평균치료시간 9.9→43.9분(약 4.4배). 표본 작아(전기간 11→14건) 방향·배율이 의미.

## 5. supervisor 확인 체크리스트 (AC4)

```
[ ] 테이블 스키마 변경 0건 (DDL이 RPC 2종 + 인덱스 1종뿐)
[ ] summary/services 반환 시그니처 LIVE와 동일 (DROP 없이 CREATE OR REPLACE 정합)
[ ] 기능 diff = 종료조건 한 줄(to_status='laser' → from_status='preconditioning') ×2, 그 외 비기능
[ ] room_id 비참조 (status 전이값 기반 종료)
[ ] 2PHANTOM lineage(roster/designated/정밀매칭/체험) 보존 — dry-run designated 12/168·services 44행 불변
[ ] 인덱스 additive·IF NOT EXISTS (비파괴)
[ ] rollback.sql 정합 (ROLLBACK 후 laser-end 수치 정확 원복)
```

## 6. 롤백

`20260623130000_foot_therapist_stats_treatment_exit_window.rollback.sql.GATE_HOLD`
→ summary(20260623120000 laser-end) + services(20260622120000 laser-end) 정의 복원. additive 인덱스는 비파괴라 유지(원복 원하면 끝 DROP INDEX 주석 해제).

## 7. 적용 절차 (AC4 통과 + AC5 confirm 후)

1. AC5 사전고지 confirm 수신 (planner/responder → 김주연, "이 날짜부터 평균치료시간 약 4배↑ = 치료실 전체 체류 포착, 정의 개선") **← PROD COMMIT 직전 HARD GATE**
2. `.GATE_HOLD` 접미사 제거 (마이그 + rollback 2파일)
3. `node scripts/...apply.mjs --apply`
4. 적용 후 smoke 검증 (treat=14·avg=43.9·desig=12/168 재현)
5. 커밋 → status:deployed, signals.md 기록
6. supervisor: 적용 후 DDL drift 0 재확인
