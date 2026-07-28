# EVIDENCE — T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID

DA CONSULT-REPLY: MSG-20260728-185221-xvx6 (verdict **GO / ADDITIVE data-lane / CONDITIONAL**)
정본: `redpay_foot_terminal_registry.md §12`

## 1. 변경 격리
- `scripts/redpay_macstudio_poller.mjs` (1 파일, FE·EF 무접촉)
- `tickets/T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID.md`
- `evidence/T-20260728-foot-REDPAY-AUTOSEED-PROVISIONAL-TID_EVIDENCE.md`
- **db-change=false**: 마이그레이션·ADD COLUMN·CREATE VIEW **0**.
  `superseded_tids text[]` + 소비뷰 UNION 은 Opt-B′(20260724170000) prod applied 旣배포 — 재실행 없음.

## 2. mechanic 정정 준수 (DA §1) — 실측 근거
### plain INSERT ✗ 확증
`redpay_terminal_registry` 제약 = `UNIQUE (merchant_id)` (20260711140000_redpay_terminal_registry_ssot.sql L?).
merchant 는 이미 registry 행 보유 → `INSERT ... ON CONFLICT(merchant_id) DO NOTHING` = **no-op silent-fail**
(신 TID 미저장, `cross_crm_write_rowcheck_standard` 위반 지문). ∴ INSERT 배제.

### superseded DISTINCT-append UPDATE ✓ (primary tid 무접촉)
```
PATCH redpay_terminal_registry
  ?merchant_id=eq.{mid}&domain=eq.foot&active=eq.true
  &tid=neq.{newTid}                         ← primary 이면 매칭 제외(멱등)
  &superseded_tids=not.cs.{newTid}          ← 이미 있으면 매칭 제외(멱등, e<>new 가드)
  Prefer: return=representation
  body { superseded_tids: DISTINCT(cur.superseded ∪ [newTid]), updated_at: now }
```
- **primary `tid` 필드는 body 에 없음 = 무접촉(append-only)**. 수동 remap 마이그(`tid=신` 승격)와 대비되는 자동경로 강화(§1).
- membership = `tid ∪ unnest(superseded_tids)`(Opt-B′) → 신 TID 즉시 가시 → 뷰 소급 표면화. raw 는 §10 admission 旣캡처(손실 0).

### provisional 컬럼 미신설 (§2 REJECT)
DDL 0. `text[]` per-element flag 불가 + merchant 레벨 도메인 경계 확정 → 안전이득 0.

## 3. 가드 (DA §4 = supervisor code-gate 검증 항목)
| # | 가드 | 코드 위치 | 검증 |
|---|------|-----------|------|
| ① | rows-affected=1 assert | `autoSeedSupersededTids` — `n = affected.length`; `n===1` 성공 / `n===0` 확증 GET 분별 / `n>1` fail-loud | PATCH `return=representation` 로 affected 회수. 0-row + 미반영 = write-차단(RLS/scope) → `[AUTOSEED-FAIL]` + 슬랙 알람(성공 오인 금지) |
| ② | 멱등 + notify-on-change-only | guard 필터 `not.cs`/`tid=neq` + `affected===1` 일 때만 `sendSlack` | 동일 TID 재감지 = 0-row change → 무알람. 배열 bloat·spam 0 |
| ③ | fail-closed | `registrySource!=='registry'` 조기반환 · `selectAutoSeedCandidates` 의 `rowByMerchant.has(mid)` 조건 · 실행부 `cur.length===0` 스킵 | 신규/미등록 merchant 자동 seed 절대 금지(§3). 285002 류 = DA CONSULT 게이트 존치 |
| ④ | A11 워치독 안전망 존치 | `redpay_terminal_watchdog.mjs` 무변경 | NEW-MERCHANT·CROSS-TENANT 독립 탐지 유지 |

## 4. self-test — 31/31 PASS
```
$ node scripts/redpay_macstudio_poller.mjs --self-test
  ✅ ... (기존 24)
  ✅ autoseed: 기등록 merchant 신 TID → 후보 1건
  ✅ autoseed: 동일 신 TID 2건 → 후보 1건 trx_count=2
  ✅ autoseed: 미등록 merchant → fail-closed 후보 0(§3)
  ✅ autoseed: 이미 primary/superseded → 멱등 no-op 후보 제외(§4②)
  ✅ autoseed: tidWhitelist 등록 TID → 스킵
  ✅ autoseed: merchant/TID 미상 → 스킵
  ✅ autoseed: data.tid-only shape 포착(COALESCE)
[redpay-macstudio][foot] ✅ self-test 전체 통과
```
- 총 ✅ 31건. 신규 autoseed 후보선택 순수함수 7-case.
- rows-affected assert / notify-on-change / 0-row 멱등vs차단 분별 = 실 PATCH 경로 = **supervisor code-gate 검증항목**(self-test 는 순수 선택자만 커버, 실 DB write 는 네트워크 필요).

## 5. build
```
$ npm run build   → BUILD_EXIT=0 (tsc -b && vite build, ✓ built in 6.17s)
```
FE 무접촉이나 회귀 없음 확증.

## 6. 킬스위치 / 롤백
- `REDPAY_POLLER_AUTOSEED_ENABLED=false` → 자동 seed 즉시 OFF(수동 seed 루프로 복귀, 코드 롤백 불요).
- 데이터 롤백 = superseded_tids 배열원소 제거(monotonic-widening 의 역, §3.1 롤백=원소제거).

## 7. governance NOTE (DA §5 고지 — planner/supervisor 대상)
registry(도메인 경계 SSOT)를 런타임 폴러가 상시 자동 mutate 하는 control 신설.
mechanic = 면제 precedent(§3.1 ADDITIVE-equiv)라 DA 자율이나 'governed SSOT 자동 mutation'
성격 명시 고지. 이견 시 planner 가 CEO 승격 판단. 리스크 최소표면화 = append-only·confirmed-foot
한정·A11 회귀센서.
