# T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP — AC-1 실측 EVIDENCE

> READ-ONLY 실측 아티팩트 (write 0 / DDL 0). 신규 merchant `1777288007` admission 판정 근거.
> 게이트: ⛔ DA CONSULT admission GO(MSG-20260806-083854-f067, pending) + supervisor DDL-diff GO-token 前 prod-apply 금지.
> commit ref: 99262f8e (artifacts) + 본 evidence.

## 대상
- window 8/03~8/06(4d) foot feed, DA A11 recon-autoroute 상시 프로브(MSG-20260806-081507-t800, §8.2-class HIGH) fold.
- merchant `1777288007` / tid `1047538244` / '오블리브-서울오리진점 풋(유선)' / cnt=4 / ₩2,988,000 (silent-drop).

## (A) DB-side 실측 — dev-foot READ-ONLY (2026-08-06 재검증)
tool: `scripts/T-20260806-foot-REDPAY-WHITELIST-EXPAND-0806GAP_ac1_readonly_probe.mjs` (SELECT only, service_role, write 0)

| 측정 | 결과 | 판정 |
|---|---|---|
| registry @merchant_id=1777288007 | **0 row** | 완전 신규 merchant (旣존재 UPDATE 아님) |
| registry 전역 tid=1047538244 (tid ∪ superseded_tids) | **0 row** | 순수 신규 (어느 旣active foot merchant 의 remap 도 아님) |
| 현 registry(foot,active) | rows=25 / merchants=25 / tids=40 | INSERT 후 26 / 26 / 41 기대 |
| redpay_raw_transactions @tid=1047538244 (external_status=Y) | **0 row / ₩0** | ⚠ raw 미적재 (신규 미등록 merchant → poller filterToFootScope drop) |
| v_redpay_reconciliation_daily @tid=1047538244 | **0 행** | 소급 표면화 대상 (편입+재폴링 후 0→4 기대) |

**★AC-1 결론(mechanic)**: `1777288007` 은 registry 전역 부재 = **신규 merchant admission INSERT (ADDITIVE)** 확정. remap UPDATE 아님. (티켓 AC-1 (a) 완전 신규 = CONFIRMED / (b) remap = REFUTED.)

**★AC-4 material 정정(티켓 'raw backfill 불요 예상' 반증)**: raw 가 애초 미적재(0행)이므로 registry INSERT 만으로는 뷰 소급 불가. admission 적용 후 **poller daily_full(8/03~8/06) 재폴링 REQUIRED** → 4 txn 재적재 → 뷰 0→4/₩2,988,000 소급 완결. (0805gap 旣active remap 은 raw 旣적재라 뷰만 소급됐던 것과 상이.)

## (B) Feed-side 실측 — A11 recon 프로브 corroboration (2026-08-06, READ-ONLY RedPay GET)
tool: `~/ops/etl/recon/redpay_registry_reconcile_probe.py --days 4 --json` (RedPay GET X-API-KEY + registry REST GET, write/DDL 0)

```
verdict: HIGH
registry: foot_active_rows=25, merchant_set=25, tid_set=40
feed: total_items=231, foot_ok_txn=129, nonfoot_txn=98 (구조배제)
new_merchant: [ { merchant_id: 1777288007, tid: 1047538244,
                  name: "오블리브-서울오리진점 풋(유선)", cnt: 4, amount: 2988000 } ]
new_tid: []
cross_tenant: []
```

- **Q1(명칭 authority)**: feed merchant.name = `오블리브-서울오리진점 풋(유선)` = band 1777288*(§1 풋 유선) 자기문서화 정합.
- **Q2(cross-tenant roster clean)**: `cross_tenant: []` + `new_tid: []` → 도수/피부/롱레 밴드 무충돌, 격리 clean. 단일 신규 회선.
- ⚠ 본 feed-side 실측은 dev-foot corroboration — **admission GO 최종 authority = DA CONSULT-REPLY**(511-60-00988 prod probe). AC-1 순서 게이트 유지.

## 게이트 시퀀스 (현 상태)
1. ✅ AC-1 dev-foot 실측 (A/B) — 완료.
2. ✅ AC-1 DA CONSULT 발행 — planner MSG-20260806-083854-f067 (status: pending, DA 회신 대기).
3. ⏳ DA CONSULT-REPLY admission GO/NO-GO.
4. ⏳ (선행) ci-gate red-main freeze 해소(meta/supervisor, ticket/T-20260720-foot-CI-RED-MAIN-RESOLVE) → main push.
5. ⏳ supervisor DDL-diff GO-token → prod-apply(20260806090000, rows-affected=1 assert) → applied_at.
6. ⏳ poller daily_full(8/03~8/06) 재폴링 = AC-4 raw backfill → 뷰 0→4/₩2,988,000 소급 검증.
