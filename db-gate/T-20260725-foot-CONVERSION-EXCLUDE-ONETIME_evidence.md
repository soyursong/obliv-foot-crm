# T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET — DB-GATE / delta evidence

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm)  · clinic `jongno-foot` = 74967aea-a60b-4da3-a0e7-9c997a930bc8
- **RPC**: `foot_stats_therapist_summary(UUID,DATE,DATE)` — CREATE OR REPLACE, 10컬럼 시그니처 무변경(42P13 불가), 테이블/DML 0.
- **변경 범위**: `exp_agg` 의 `exp_conv`(전환 분자) 판별식 1곳. 분모(exp_total)·체험 판별·측정창·roster·지정비율 = LIVE 그대로.
- **총괄 확정 SSOT**: 김주연 총괄(C0ATE5P6JTH), slack ts 1784983193.079089 (via planner MSG-20260725-214656-ci8j).

## 전환(분자) 정의 (총괄 확정)
- 전환 = **체험권 차감 내원 → 당일(KST) 신규 '정식(다회차) 패키지' 발행** 케이스만 카운팅.
- **1회성 티켓 차감 내원 → 패키지 발행 = 분자 제외**(반영 금지). 트리거 = 체험권 차감 내원(=분모 모집단).

## '1회성 티켓' / '정식 패키지' 데이터 매핑 (AC#2)
prod `packages` 분류 (2026-07-25 read-only):
- **정식 패키지(전환 대상)** = total_sessions≥2 AND 체험권 아님 AND 템플릿 아님 AND 양도 아님:
  12회권(25)·24회권(11)·36회권(7)·48회권(2)·custom 다회차(15)·포돌로게(1)·preset_12 제외.
- **1회성 티켓(제외)** = total_sessions=1 단건: AF레이저(6)·오니코레이저(6)·힐러레이저(2)·아톰레이저(1)·custom 단건(44)·template(1).
- **체험권(제외, 분모이자 비전환)** = 무좀체험권(107)·내성체험권(7)·체험권(1) — 2회차 체험권 포함 전부 전환 아님.

## before/after delta (MIG-GATE dry-run, LIVE vs shadow, no-persistence)
※ 재실측 2026-07-26 (데이터 성장으로 7월 88→89, exp_conv 0→1 반영). delta·회귀 판정 불변.
| 기간 | LIVE exp_total | NEW exp_total | 회귀 | LIVE exp_conv | NEW exp_conv | Δconv |
|------|----:|----:|:--:|----:|----:|----:|
| 2026-07 | 89 | 89 | 없음 | 1 | 1 | 0 |
| 2026-06 | 1 | 1 | 없음 | 0 | 0 | 0 |

- **experience_total 무회귀 실증**: 89(7월)·1(6월) LIVE=NEW 동일 (AC#4 ✓). 본 변경은 분모 무접점.
- **conversion delta = 0**: LIVE exp_conv=1(김규리, 체험 내원 당일 발행 '24회권'=정식 다회차 패키지) → NEW 정의로도 1(24회권은
  total_sessions=24·비체험권·비양도 → 정식 전환 유지). 1회성/체험권 발행은 애초 분자에 없어 무변동 → **화면 수치 무변동(33.3% 유지)**.
- **왜 수치가 안 낮아지는가**: 현 prod 에서 전환으로 잡히던 유일 1건이 이미 정식(다회차) 패키지라 SSOT 재정의로도 살아남음.
  1회성 티켓이 전환으로 잡히던 실데이터가 現 0건(구조적 leak 경로만 존재) → 이번 정정은 그 leak 경로를 봉쇄하는 예방적 가드.
- 참고(전기간): '체험 고객이 (당일 아닌) 나중에 정식패키지 구매' 케이스는 '당일' 요건으로 정상 제외(SSOT 부합).
- shadow 함수 사후부재(post-probe) 확인 = 무영속(post_probe_shadow_dropped=true).

## 백필/재집계 (AC#6)
- 집계단(recompute) 수정 → 원본 무접점 → 과거 전구간 **자동 재집계**(STABLE 조회 시 재계산). 백필 DML/freeze셋 불요.
- **delta=0 이라 소급 숫자 무변동** → 현장 확인 게이트 실질 no-op(과거 전환 수치 안 바뀜). data_correction_backfill_sop 대상 아님(원장 mutable UPDATE 0).

## dry-run raw
```json
{
  "generated_by": "dev-foot",
  "ticket": "T-20260725-foot-CONVERSION-EXCLUDE-ONETIME-TICKET",
  "clinic_id": "74967aea-a60b-4da3-a0e7-9c997a930bc8",
  "2026-07": {
    "LIVE": {
      "exp_total": 88,
      "exp_conv": 0
    },
    "NEW": {
      "exp_total": 88,
      "exp_conv": 0
    },
    "exp_total_regress": false,
    "exp_conv_delta": 0
  },
  "2026-06": {
    "LIVE": {
      "exp_total": 1,
      "exp_conv": 0
    },
    "NEW": {
      "exp_total": 1,
      "exp_conv": 0
    },
    "exp_total_regress": false,
    "exp_conv_delta": 0
  },
  "post_probe_shadow_dropped": true,
  "VERDICT": {
    "experience_total_no_regression": true,
    "conversion_delta_2026_07": 0,
    "conversion_delta_2026_06": 0,
    "shadow_cleaned": true,
    "pass": true
  }
}
```
