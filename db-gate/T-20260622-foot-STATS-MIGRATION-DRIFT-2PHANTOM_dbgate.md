# T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM — DB GATE / 적용 증거

DB: rxlomoozakkjesdqjtvd (obliv-foot-crm) · dev-foot · 2026-06-23

## 리스크 5항목
1. DB 스키마: **있음** — RPC `foot_stats_therapist_summary` 재정의(DROP+CREATE, 반환 7→10컬럼). 테이블 스키마 무변경. ADDITIVE(read-only 컬럼 추가, 데이터·측정창 무변경) → 숫자 이동 없음.
2. 외부 서비스 의존: 없음
3. 비즈니스 로직: **없음**(designated 부분). treatment_exit(측정창 변경=숫자 이동)은 본 티켓 미적용·게이트 보류.
4. 대량 데이터: 없음(RPC 정의 교체, 데이터 무변경)
5. 신규 npm: 없음

## 적용 (AC2 — designated on roster)
- 파일: `supabase/migrations/20260623120000_foot_therapist_stats_designated_on_roster.sql`
- 절차: 진단(diag.mjs) → dry-run(BEGIN;apply;ROLLBACK, 원복 확인) → 실적용(COMMIT) → 검증.
- 적용 전 시그니처: `TABLE(... conversion_rate numeric)` = 7컬럼.
- 적용 후 시그니처: `TABLE(... conversion_rate numeric, designated_count int, total_checkin_count int, designated_rate numeric)` = 10컬럼 ✅ (FE `stats.ts` TherapistSummaryRow 계약 일치)
- 무결성 검증: 전 11행 `designated_count <= total_checkin_count` 통과. 0활동 재직 치료사(김지현/최다혜) → total=0 → rate=NULL → FE "데이터 없음".
- 회귀 확인: roster 11명 명단·laser-end 측정창·check_in_id 정밀매칭·체험전환율 — 적용 전후 동일(designated 3컬럼만 추가).

### 적용 후 실측 (이번 달, 첫 클리닉)
```
조선미: desig=0/19 rate=0.0    김규리: desig=4/18 rate=22.2
임별:   desig=4/18 rate=22.2   서은정: desig=2/16 rate=12.5
윤시하: desig=0/15 rate=0.0    (… 0활동 재직치료사 rate=NULL)
```

## 롤백
- `supabase/migrations/20260623120000_foot_therapist_stats_designated_on_roster.rollback.sql`
- 적용 직전 LIVE(20260622120000 staff_source_filter) 7컬럼 roster 정의로 복원(designated 3컬럼 제거).
- 재실행 안전: DROP IF EXISTS + CREATE (멱등).

## phantom 정리 (AC4 — drift 0)
- `20260609220000_..._designated_ratio.sql` → `.sql.SUPERSEDED` (+ .rollback) — 기능을 20260623120000 가 흡수.
- `20260612130000_..._treatment_exit.sql` → `.sql.GATE_HOLD` (+ .rollback) — 측정창 변경 게이트 대기.
- 결과: applied-set 내 phantom 0. LIVE summary(10컬럼 roster laser-end) = 20260623120000 = FE 계약 일치.

## 잔여 게이트 (treatment_exit, 별도 티켓 권고)
측정창 종료를 치료실 퇴실 기준으로 정정하는 건 = 평균치료시간/treatment_count **숫자 이동**.
적용 전 필수: data-architect CONSULT + supervisor DDL-diff + 필드(김주연 총괄) 숫자변동 사전고지.
또한 현 roster(20260623120000) 베이스 위에 측정창만 정정해야 함(stale 원형 재적용 시 AC3/AC4 회귀).
