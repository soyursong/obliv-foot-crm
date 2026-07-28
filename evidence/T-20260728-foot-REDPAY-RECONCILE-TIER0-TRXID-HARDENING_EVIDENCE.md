# T-20260728-foot-REDPAY-RECONCILE-TIER0-TRXID-HARDENING — 검증 증거

DA CONSULT-REPLY: **verdict=GO (재확인)** — MSG-20260728-183108-2rqg (P2, 기결 GO 승계)
정본: `da_decision_foot_redpay_reconcile_tier0_trxid_hardening_20260728.md` + `cross_crm_data_contract §1265`

- change-class: **순수 EF 코드레인 (no-DDL · no-mutation · §3.1 파괴 열거 미해당)**
- 대표게이트 **면제** (DA 동의) → **supervisor code-gate만**
- 구현 commit: `0ddedfed` (findTier0Direct 3단 캐스케이드 + 회귀 테스트) — **이미 origin/main 병합됨**

## LOCK 반영 확인 (제안 문구보다 강함)

| LOCK | 요구 | 코드(matcher.ts findTier0Direct) | 상태 |
|------|------|--------------------------------|------|
| [D1] composite = 풀 Model A | approval_no ∧ amount ∧ tid ∧ approved_at-윈도 **4조건 전부** | L227 `if (!hasApproval \|\| !hasTid \|\| !raw.approved_at) return []` + L234~242 4조건 AND | ✅ |
| [D2] 신규 윈도 발명 금지 | 기존 Tier1 forward `[approved_at,+15min]` 재사용 (§789 그림자윈도 ban) | L242 `TIER1_WINDOW_MS` 재사용 | ✅ |
| 제안#2 은퇴 | bare approval_no-alone / tid-alone / bare-tid auto-link 폐기 | ③ 가지 삭제 — 4조건 미충족 시 `return []` | ✅ |
| 제안#1 trxid-exact 1급 | direct 최우선 | ① L213~221 (오늘 inert, direct-capture future-proof) | ✅ |
| 제안#3 downstream count trxid 통일 | trxid-SSOT | detectMissingInCrm = `external_trxid` 기준 (旣 trxid-SSOT) | ✅ |
| AC-5 취소/환불 링크 불변식 | root_trxid/external_trxid(trxid계열) 유지, approval_no 이관 금지 | detectRefundNotInCrm L613 `root_trxid ?? external_trxid`, approval_no 미사용 | ✅ |

## GO 조건 3종 (supervisor code-gate 내용)

### (1) backtest READ-ONLY — OVERALL_PASS ✅
`scripts/..._backtest.mjs` (SELECT 전용, 무-mutation) → `..._backtest.json`

- **커버리지: 풋 redpay_raw_transactions 405행 전수(100% census) + payments 366행 전수.**
  DA 명시 창(≥7259행/235페어)은 풋 실 데이터 볼륨과 불일치 → **body/크로스센터·집계 지표로 추정**(fork 횡전개 provenance drift). 풋은 전수 census 로 더 강한 근거 확보.
- 축(a) auto-match drop: OLD tier0 auto **0** = NEW tier0 auto **0** → **drop 0** ✅
  (근거: payments external_approval_no=0/366, external_tid=0/366 populated → OLD bare-key 발화 0. NEW composite 도 동일 0. trxid-exact 는 trxid-populated 135건이 전부 旣매칭이라 isUnmatchedCrm 배제 → inert.)
- 축(c) 신규 false-merge: NEW auto ⊆ OLD auto, **false-merge 0** ✅
- 축(b) refund-path 보존: 취소(N/X/M) 45건 중 root_trxid/external_trxid 체이닝 페어 보존 — predicate 변경과 무접점(trxid계열) ✅

### (2) regression unit test — 40/40 PASS ✅
`deno test supabase/functions/redpay-reconcile/` → **40 passed, 0 failed**
`tier0-hardening.regress.test.ts` (11건): bare approval_no 소멸 / bare tid 소멸 / composite 4조건 전부 요구 / Tier1 윈도 재사용(경계 포함·+1ms 배제) / trxid inert / 취소 early-return / refund root_trxid 무영향 고정.

### (3) 0-DDL diff + 코드리뷰 ✅
commit `0ddedfed` diff = `matcher.ts` + `tier0-hardening.regress.test.ts` 2파일. **migration/.sql 0건 → 0-DDL 확정.**

## 미래 시맨틱 (회귀 아님)
external_approval_no 채워진 후 composite 불충족분 = auto-link 대신 tier4_manual 강등(fail-safe, 손실 아님·수동회수). 조용히 drop 금지 — 코드상 하위 Tier→tier4_manual 폴백으로 이미 보장.
