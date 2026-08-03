# T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE — EVIDENCE (AC-0~3)

- domain: foot · obliv-foot-crm · registry membership soft-flag(no DDL, no ledger)
- reporter: 최필경 총괄 (C0ATE5P6JTH, thread 1785716108.106509)
- 실행일: 2026-08-03 (dev-foot)
- ★안전 게이트: '무거래 스캔' 산출 단독 신뢰 금지 → 레드페이 raw 정본(VAN∪조회API) 재대조로 '진짜 0건' 확정분만 비활성.

---

## 결론 요약 (총괄 회신용)

| TID | merchant | 라벨 | raw(정본 feed) 총량 | 적재 | 판정 | 조치 |
|---|---|---|---|---|---|---|
| 1047479476 | 1777289002 | 풋(멀티) | 0건 | 0 | TRUE-ZERO | ✅ **비활성** |
| 1047479148 | 1777289010 | 풋(무선) | 0건 | 0 | TRUE-ZERO | ✅ **비활성** |
| 1047479155 | 1777289011 | 풋(무선) | 0건 | 0 | TRUE-ZERO | ✅ **비활성** |
| 1047479157 | 1777289013 | 풋(무선) | TID=0건, **단 merchant는 07-23 순액0 취소쌍 2건** | 0 | HAS-TXN(merchant) | ⛔ **보류** |
| 1047479158 | 1777289012 | 풋(무선) | feed 2건 net0 (control) | 0 | HAS-TXN | ⛔ 보류(旣) |

**→ 3대(476·148·155) 비활성 완료. 157은 비활성 보류(158과 동일 class로 CANCELPAIR-AUDIT 편입).**

---

## AC-0 (raw 재확인 게이트, READ-ONLY) — 스캔 아닌 정본 feed 대조

- 도구: `redpay_completeness_reconcile_probe`(A12) 계열 feed-pull(`a11.fetch_redpay_feed`) 재사용. RedPay 정본 payments.php(X-API-KEY, business_no=457-23-00938 = 구 511 flip 흡수) **라이브 재조회 → 과거 적재갭 면역**.
- 관찰구간 2026-07-01 ~ 08-03(단말 registry created 07-17 포함, 14일 청크 3분할 pull, 총 835건).
- 승인·취소 raw 건수(netting 前) per-TID 집계 + 적재(`redpay_raw_transactions`) 대조.
- **control 158로 방법 검증**: feed{cnt2, status Y+N, net0} vs 적재 0 = HAS-TXN 정확 포착 → 스캔0의 은폐거래를 raw가 잡음을 실증(FILTER-AUDIT verdict 재현).
- **476·148·155**: feed 0건 AND 적재 0건 = 진짜 무거래(3상태 중 (b)). merchant grain도 feed 0.

## AC-0b (부수효과 가드) — 157 은폐활동 발견

- merchant grain 확인 결과 **merchant 1777289013(157 소속)이 sibling TID 1047479153으로 feed 2건 활동**:
  - `2026-07-23 18:16:29 status Y +1,004원 trxid 0723C8125591` (승인)
  - `2026-07-23 18:16:46 status N -1,004원 trxid 0723C8125598` (즉시취소, 17초 후)
  - 순액 0 = **158과 동일 승인+즉시취소 net0 테스트쌍**. 스캔에는 0건으로 은폐.
- 추가: tid 1047479153은 registry에서 **다른 merchant(1777289009)에 등록** = TID↔merchant 매핑 불일치.
- ∴ TID 157 자체는 0건이나 **소속 merchant가 비활성 대상이 아닌 활성 거래주체** → 비활성 시 (a)활성 단말 오비활성 (b)매핑 미해소 상태 조작 위험 → **보류·별건 편입**.
- (참고: 폴러 admission = env merchant allowlist(`REDPAY_MERCHANT_WHITELIST` set)라 registry active flag는 적재 admission에 무영향 → 비활성이 적재 부수효과는 없음. 그럼에도 '활성 거래 merchant'는 비활성 대상 부적격.)

## AC-1 (비활성 방식, no-DDL) — soft flag 확인

- `redpay_terminal_registry`에 `active boolean NOT NULL DEFAULT true` **mutable soft flag 존재** → 신규 컬럼 불요, **db_change=false 유지**(DA CONSULT 1차 게이트 미발동). hard-delete 경로 미사용.

## AC-2 (비활성 실행, freeze-set) — 3대 soft off

- **freeze-set = {1047479476, 1047479148, 1047479155}** (하드코딩, AC-0 TRUE-ZERO 3).
- `UPDATE ... SET active=false ... WHERE tid IN (freeze) AND domain='foot' AND active=true RETURNING` → **rows-affected=3 = freeze-set 크기 assert PASS**.
- 원장(payments/reconcile) 무접점. soft(active=false)만, hard-delete 0, DDL 0.
- 롤백 SQL 자동 생성: `_ac2_rollback.sql`(active=true + 원본 source/updated_at 복원).
- foot registry: active 27 → **24** (−3), total 27 불변.
- 실행 전/후 diff: `_ac2_evidence.json`.

## AC-3 (보고·relay)

- 총괄 회신 = responder 경유(C0ATE5P6JTH thread 1785716108.106509): (a)476·148·155 진짜0 확정·비활성 (b)157 보류(merchant 07-23 순액0 취소쌍 158-class) (c)157 CANCELPAIR-AUDIT 편입 보고.

---

## 산출 아티팩트

- `_ac1_introspect.mjs` — registry 스키마·5 TID 상태
- `_ac0_rawcensus.py` / `_ac0_census.json` — feed↔raw per-TID census
- `_ac0b_merchant_coverage.mjs` — merchant grain 커버리지·부수효과 가드
- `_ac2_apply.mjs` / `_ac2_evidence.json` / `_ac2_rollback.sql` — 비활성 실행·롤백

## 스코프 준수

- soft flag only, 원장 무접점, DDL 0, self-reference 차단(정본 feed 재대조). READ-ONLY census 인증컨텍스트 = service_role(정규 env, anon RLS Silent-0-Row 회피).
