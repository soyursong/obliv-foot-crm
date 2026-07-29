---
id: T-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
data_consult_gate: "satisfied — DA CONSULT-REPLY GO (decision_id=DA-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT, SSOT=da_decision_foot_redpay_trxid_nonunique_composite_20260729.md). no-DDL·no new column/table/enum → §S2.4 gate 통과."
e2e-spec: "ef_only — deno test supabase/functions/redpay-reconcile/ (62/62 PASS). 신규 trxid-nonunique-composite.regress.test.ts 11-case(AC-2 (a)8자형 shared·(b)단형 재사용·(c)bare trxid auto-link 소멸·(d)refund 부호+금액+시각 disambiguate) + 기존 tier0-hardening refund 케이스 Q4 정정. reconcile=EF(Deno) + macstudio 폴러, FE E2E 무관 → deno self-test 대체."
summary: "RedPay 매칭/dedup/카운트 유일키 재정의 (trxid 전역 거래고유 REFUTE → non-sole-key composite). DA CONSULT-REPLY 이행. [Q1 K1 dedup] (external_trxid,external_status,amount) 3키 이미 live·probe=0(triple-collision 0 both bands) → 코드 무변경·불변식 codify only. [Q2 K2 match] findTier0Direct ① trxid-exact 단독 가지 폐기(bare trxid auto-link 소멸) → trxid 를 approval_no·tid 와 동일 corroborator 로 강등, 단일 composite(식별자 ∧ amount ∧ card ∧ payment ∧ same-KST-day ∧ forward, 다후보→tier4_manual)로 봉인. 현 링크 delta=0(構造的 inert). Plan B PAYPAGE-BUILD 착지 前 봉인 선행. [Q3 K3 count] raw-row-grain REQUIRED 불변식 codify(계수/집계 trxid DISTINCT/GROUP-BY 금지). [Q4 refund root] detectRefundNotInCrm STRENGTHEN — root_trxid 단독 REJECT → trxid계열 ∧ 반대부호 ∧ |amount| 동일 ∧ 원거래(payment·reconciled) ∧ 시각순서(원거래≤환불) + 최근접-직전 tiebreak + 다후보→수동(payment_id null). 순수 EF·no-DDL."
created: 2026-07-29
reporter: data-architect
parent: DA-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT
commit: PENDING_SUPERVISOR_MERGE
risk_verdict: GO
risk_reason: "변경 격리 = supabase/functions/redpay-reconcile/matcher.ts 1파일(순수 함수 모듈, Deno/Supabase 의존 無) + 2 regression test + ticket. no-DDL(신규 컬럼·테이블·enum 0 → DA CONSULT 불요·본 티켓이 CONSULT-REPLY 이행) · no-data. [Q2] findTier0Direct 는 現 構造的 inert — 매칭풀 불변식(payments.external_trxid IS NULL)상 trxidCorroborates 발화 불가 + AC-5 evidence(external_approval_no/tid 노출 0/295) → tier0 auto-link=0 → 미매칭 전환되는 기존 링크 0(behavior-preserving delta=0). bare trxid-exact 단독 return 경로 構造적 제거로 Plan B 직수집 활성화 시 단형 shared/재사용 trxid false-merge 사전차단. [Q4] refund detector 는 predicate 강화(narrowing) → 오원거래 오링크 축소 방향, 신규 false-positive 0. 부분취소(M, |amount|≠)는 DA §6 spec 준수로 미발화(스코프 밖 후속). deno test 62/62 PASS(신규 11 + 기존 회귀). vite build OK. reconcile EF 는 CF Pages push 로 auto-deploy 안 됨(supabase functions deploy 별도) → push=repo only. supervisor code-gate만(전수 census backtest READ-ONLY + 0-DDL diff)."
option_decision: "DA §7 게이트 split 이행 — Q1 3키 확정/Q3 codify=무게이트(코드 무변경·불변식 주석). Q2 Tier0① composite 봉인·Q4 refund root strengthen = DA GO·CEO면제·supervisor code-gate. Q1 approved_at 확대는 probe=0 → NOT triggered(CEO게이트 미발생)."
supervisor_ac: "AC(supervisor code-gate, DA §7): (1) backtest READ-ONLY 전수 census(windowed 금지): 현 auto-matched 링크 drop 0 · 승인/취소·8자형 shared-trxid 페어 양쪽 보존(부호·금액) · 신규 false-merge 0. (2) regression fixture 4항 = trxid-nonunique-composite.regress.test.ts (a~d) 동봉. (3) 0-DDL diff 확증(Q1 approved_at 확대 미포함)."
---

# T-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT

DA CONSULT-REPLY 이행 (in-reply-to MSG-20260729-165100-ob99 / dev-foot CONSULT MSG-20260729-164230-u8wy).
정본 = `da_decision_foot_redpay_trxid_nonunique_composite_20260729.md`
(decision_id=DA-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT, 1차 게이트=DA 확정).

## CORE
trxid 전역 거래고유 **REFUTE**. 07-28 "trxid=K+tid+YYMMDDhhmmss+승인번호=합성 유일키·충돌 불가" RETRACT.
census 실증: 서울오리진 K+30자(dup0)만 합성구조, 송도 단형(dup10)은 재사용·8자형 승인/취소 shared trxid.
→ trxid 를 approval_no·tid 와 동일 **non-sole-key** 계열로 확정. 유일키는 하나가 아니라 **층별 3개**(K1 dedup / K2 match / K3 count) — 통일 금지.

## 착수 결과 (Q1~Q4)

| Q | 층 | 이행 | 코드 |
|---|----|------|------|
| **Q1** dedup(K1) | within-source | 3키 `(external_trxid,external_status,amount)` 이미 live · **probe=0(triple-collision 0 both bands)** → 확정 종결 | **코드 무변경** · 불변식 codify(matcher.ts docblock) |
| **Q2** match(K2) | cross-source | `findTier0Direct` ① trxid-exact 단독 가지 폐기 → trxid=corroborator 로 단일 composite 봉인. bare trxid auto-link 소멸. delta=0(inert) | matcher.ts `findTier0Direct` |
| **Q3** count(K3) | report | raw-row-grain REQUIRED — trxid DISTINCT/GROUP-BY 금지 불변식 codify | matcher.ts docblock(뷰=passthrough, 코드 무변경) |
| **Q4** refund(K2') | cross-source | `detectRefundNotInCrm` STRENGTHEN — root_trxid 단독 REJECT → 부호+금액+시각 disambiguate | matcher.ts `detectRefundNotInCrm` |

## 게이트 (DA §7 split)
- Q1 3키확정/Q3 codify = **무-게이트**(DA codify).
- Q2·Q4 = **DA GO · CEO면제 · supervisor code-gate**.
- Q1 approved_at 확대 = probe=0 → **NOT triggered**(CEO게이트 미발생).

## 착지 순서
Q1/Q2/Q4 상호 독립. **Plan B PAYPAGE-BUILD 착지 前 Q2 봉인 선행** = 본 티켓으로 충족.

## 검증
- `deno test supabase/functions/redpay-reconcile/` → **62 passed / 0 failed**.
  - 신규 `trxid-nonunique-composite.regress.test.ts` 11-case (AC-2 (a)~(d)).
  - 기존 `tier0-hardening.regress.test.ts` refund 케이스를 Q4 정정 반영.
  - 기존 `tier0-composite-ac5.regress.test.ts` 6-case 무회귀(delta=0 재확인).
- `npm run build` OK.
- no-DDL / no-data.

## cross-CRM 파급 (비블로킹, DA §9)
fork(women/body/scalp2/롱레/derm) 상속 = **K1/K2/K3 3층 분리 + non-sole-key composite 불변식** predicate 뿐.
볼륨·포맷 census 는 **도메인별 실측**(foot 송도 수치 상속 금지). body(송도/도수)는 8자형 shared trxid data-real →
`T-20260729-body-REDPAY-DEDICATED-PIPE-NEED` 파이프 born 시점 composite 규율 선탑재 (DA 가 dev-body/planner INFO 통지).
