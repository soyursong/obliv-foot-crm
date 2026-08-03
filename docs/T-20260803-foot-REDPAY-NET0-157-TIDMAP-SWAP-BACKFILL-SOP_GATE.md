# T-20260803-foot-REDPAY-NET0-157-TIDMAP-SWAP-BACKFILL-SOP-ENVELOPE — supervisor dry-run 게이트

레드페이 registry TID↔merchant 전치 등재오류 정정 (Data-Correction Backfill SOP 봉투, no-DDL data-lane).

## freeze-set (정확히 이 2 매핑행)
| merchant | registry 현재(오류=전치) | feed 정본(정정 목표) |
|---|---|---|
| 1777289013 (풋 무선) | tid 1047479157 | tid 1047479153 |
| 1777289009 (풋 무선) | tid 1047479153 | tid 1047479157 |

> 정정 = 두 tid(153·157)의 merchant 귀속 swap. 단일 count blanket UPDATE ✗ — merchant_id + 현재 tid(오류값) exact 지문으로만 write.

## 근거 (부모 진단 3소스 진실표)
- feed 정본(payments.php) + persisted raw 2소스 = 289013↔153 / 289009↔157 로 일치.
- registry 홀로 outlier(289013↔157 / 289009↔153, 2026-07-11 seed prod-probe 전치 추정).
- 총괄(최필경) confirm: 07-23 1,004원 TID1047479153 net0 = 테스트 거래 확정(MSG-20260803-215849-yetu, 45일 전수분석).

## 산출물
| 파일 | 역할 |
|---|---|
| `supabase/migrations/20260804010000_redpay_foot_registry_tidmap_swap_backfill.sql` | swap UPDATE (freeze-set 지문 가드, 멱등) |
| `..._tidmap_swap_backfill.rollback.sql` | swap 역전(전치상태 복원, 손실 0) |
| `..._tidmap_swap_backfill.dryrun.mjs` | 무영속 dry-run 러너(freeze-set precheck + rows-affected=2 assert + 3소스 재일치 census) |

## SOP 4게이트 (supervisor 실행 — 실 apply 전 필수)
1. **freeze-set 재검증 (AC-1)** — dryrun ① pre-probe: registry 현재상태가 진단 진실표(전치)와 exact 일치. 불일치=중간변경 → abort.
2. **rows-affected assert (AC-1/AC-2)** — dryrun ② trial-apply sentinel: rows_affected=2 아니면 abort. 원장 무접점(payments·canonical 457/511 무접촉).
3. **롤백 리허설 (AC-3)** — rollback.sql 무영속 리허설로 역전 가능 확인.
4. **정정 후 3소스 재일치 census (AC-4)** — dryrun ④ forecast: swap 후 registry pairing = feed 정본 수렴 + membership(289009·289013·153·157 모두 foot) 불변 → 대사뷰 merchant 289013 가시성 훼손 없음.

## 실행
```
node supabase/migrations/20260804010000_redpay_foot_registry_tidmap_swap_backfill.dryrun.mjs
```
필요: `.env.local` `SUPABASE_ACCESS_TOKEN` (Management API PAT). Supabase ref = rxlomoozakkjesdqjtvd.

## GO 후속
- supervisor 4게이트 통과 → up.sql 실적용(rows-affected=2 실측).
- **AC-5**: 정정 완료 후 부모 T-20260803-foot-REDPAY-NET0-HOLD-157-TIDMERCHANT-DRIFT 의 157 단말 최종 판정(HOLD 해제 여부). **정정 완료까지 157 active=true 유지.**
- membership 불변 swap → 대사 가시성 훼손 없음(GO_WARN 완화 근거). no-DDL → DA 스키마 게이트 불요.
