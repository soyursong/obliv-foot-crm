# T-20260729-foot-REDPAY-DBVSAPI-CAPTURE-GAP-VERIFY — dev-foot 실측 evidence

- **정본**: `da_decision_foot_redpay_dbvsapi_capture_gap_20260729.md` (DA-20260729) / registry §14
- **성격**: 전건 read-only · no-DDL · no-data (ADDITIVE-equiv). db_change=false. registry SSOT 무접촉.
- **실행**: 2026-07-29 05:2x~05:31 KST, macstudio, `~/ops/etl/recon/redpay_completeness_reconcile_probe.py` (A12)
- **환경**: foot Supabase `rxlomoozakkjesdqjtvd`

---

## AC-0 — probe 무결성 (selftest, DB 무접속)

`python3 redpay_completeness_reconcile_probe.py --selftest` → **11 PASS / 0 FAIL**.
- READ-ONLY guard 발행 SQL 3종 전건 통과, mutation/DDL 5종 전건 차단(write0 = db_change=false 확증).

## AC-1 (must · DIAGNOSE-FIRST) — A12 probe 07-24~present read-only 실측

라이브 위험 실측 = A12 delta1(feed−적재)로 pipeline-failure(적재누락/유실) 클래스 탐지.

### settled 창 (lag=2, days=4 → 07-24~07-27, FP-suppressed authoritative)
| date | delta1 cnt | delta1 net | dir | verdict |
|------|-----------|-----------|-----|---------|
| 2026-07-24 | −1 | −10,000 | count-skew | HIGH(net clause) |
| 2026-07-25 | −3 | −50,150 | count-skew | HIGH(net clause) |
| 2026-07-26 | 0 | 0 | even | GREEN |
| 2026-07-27 | −10 | −116,220 | count-skew | HIGH(net clause) |
| **window 합** | **−14** | **−176,370** | | |

### present-inclusive (lag=0, days=6 → 07-24~07-29, in-flight 포함)
07-28 delta1 cnt=−12 net=−4,559,200 (in-flight, T-1) · 07-29 0/0 (미settle) · 나머지 동일.
※ 07-28 in-flight 갭은 후속 daily_full 재가동(AC-2)으로 회수됨.

### ★핵심 판정 (severity 근거)
- **under-ingestion 일자(feed>적재 = 유실/pipeline-failure 클래스) = 0건.** window 전체에서 feed가 적재를 초과한 날 없음.
- delta1 net≠0 은 **전부 count-skew(적재≥feed) = 역방향 = over-capture/forward-integrity(delta0) 클래스** — AC-1 rule이 겨냥한 "적재누락 유실" 클래스가 **아님**.
- **over-capture root cause (실증)**: probe feed 카운트 = merchant band-prefix(`is_foot_signal`: 1777285/288/289) · poller 적재 = registry allowlist(27 merchant/40 tid). 07-24~29 band-feed **158** = poller 적재분 **158** (일치). 그러나 DB `redpay_raw_transactions` = **183** (+25) = 다중소스 누적(webhook 실시간 경로 + 승인/취소 void-쌍 별도행). net 크기(−10k/−50k/−116k)는 void-쌍 수준 = **phantom 매출 아님**.
- ∴ **라이브 매출 유실 없음.** net≠0 은 forward-integrity(delta0) 클래스 = DA AC-3 fold 대상(매출 과대계상 candidate, 유실 아님).

**dev 권고 severity: P2 유지** (유실/capture-gap 축 = under-ingestion 0건 · 라이브 매출영향 없음). 단 문언상 delta1 net≠0 이므로 최종 판정은 planner. over-capture(delta0)는 DA delta0 fold + delta1 `structural-capture-gap` LOW-note로 수렴 권고(정본 §Q1 line34/AC-3 정합).

## AC-2 (must) — daily_full 상태 진단 + 재가동

`redpay_poller_state(id=1)` 진단:
- `last_incremental_to` = 2026-07-28 20:26:55Z (=07-29 05:26 KST) → **incremental 폴러 ALIVE·current** (5분 주기, 정상).
- `last_daily_to` (진단 시점) = 2026-07-24 03:11:14Z → 정지처럼 보임.

**진단 정정 (중요)**: `last_daily_to`는 **poller daily_full 모드만** 갱신 — 스케줄러 없음(수동/온디맨드). 실 자동 안전망 = **EF `redpay-reconcile` daily_full**(`com.medibuilder.redpay-recon-daily.plist`, 매일 14:00). 로그(`/tmp/redpay-recon-daily.log`) 실측:
- 07-25/26/27 정상(upserted 46/33 등 late-arriving 회수 = 안전망 작동).
- **07-28 14:00 단발 실패**(`errors:1, events:0, elapsed 212ms` = transient API/network hiccup).
- 07-29 자동 실행(14:00)은 아직 미도래(실행시각 05:31 KST).

**재가동 조치**:
1. EF daily_full 수동 재실행 → `fetched:83, upserted:83, errors:0` (07-28 실패 = 비영속 transient 확인, 회수 완료).
2. poller daily_full(07-24~present backfill) 실행 → `last_daily_to` **07-24 → 2026-07-28T20:31:02Z(07-29 05:31 KST) 갱신**, fetched 269 / scoped_out 111(non-foot 구조적 차단) / upserted 158 / errors 0 / drift 0.

∴ **안전망(EF + poller-state) 양측 RESTORED.** incremental은 애초 무중단. 다음 자동 daily_full 14:00 정상 재개.

## AC-3 (optional · DA 주도) — mjs forward-db-only → A12 delta0 수렴

정본 detect surface = A12 python. AC-1 실측이 delta0(적재→feed 부재, forward-integrity) 신호(적재 183 vs feed/ingest 158, +25)를 노출 → DA delta0 fold의 실데이터 근거 제공. dev는 python 이관 조율 협조(정본 §ball). registry SSOT 무접촉 유지.

## 무접촉/금지 준수
- registry SSOT 무접촉 ✅ / bidir mjs 별도 상시축 미승격 ✅ / db_change=false(probe write0 + 안전망 재가동은 멱등 upsert 정상운영, DDL/스키마/데이터정정 0) ✅ / 매출 split 산식·admit 무접촉 ✅

**audit artifact**: `~/claude-sync/memory/_silver/2026-07-29/consistency_audit.md` (A12 append)
