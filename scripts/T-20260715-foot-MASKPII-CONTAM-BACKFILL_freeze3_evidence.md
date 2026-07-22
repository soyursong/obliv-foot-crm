# T-20260715-foot-MASKPII-CONTAM-BACKFILL — FREEZE 3차 패스 (post-seal, READ-ONLY)

- author: dev-foot / 2026-07-23
- run_stage: **freeze-3rd (소스 봉쇄 後 대상셋 재산출)** — DA 4-경로 재진입 중 (3)단계
- mutation: **0** (READ-ONLY). 실 정정은 DA 재자문 GO + supervisor DB-GATE 후에만.
- 소스: freeze2.mjs 재실행(지문 SSOT 불변) + check_ins 스냅샷 복구가능성 추가 probe
- git-evidence JSON: `scripts/T-20260715-foot-MASKPII-CONTAM-BACKFILL_freeze3_evidence.json`
- off-git 판정근거(PHI): `~/foot-phi-offgit/T-20260715-foot-MASKPII-CONTAM-BACKFILL_freeze2_confirm.json`

## 0) 하드 의존 해소 실측 (supervisor 주장 아닌 dev-foot 자체 실측)

Management API `pg_trigger` introspection (2026-07-23):
```
trg_customers_reject_masked_pii | tgenabled='O' | BEFORE INSERT OR UPDATE ON public.customers
                                | FOR EACH ROW EXECUTE FUNCTION _trg_customers_reject_masked_pii()
```
→ **has_trigger=true 확정. 소스 봉쇄 성립** = `data_correction_backfill_sop` "소스 봉쇄 후 착수" 전제 충족.

## 1) freeze 대상셋 (지문 교집합, 단일 count blind 금지)

- scanned customers: **597행**
- 마스킹 지문 hit (name '*' OR phone effective digits 1-7): **8행** — 전부 `created_by=NULL` (anon-RPC 앵커)
- split: name_star **8** / phone_short(only) **0**
- freeze PK8: `512998d0 67ea1793 bd307dfe 44a6a076 2dc21d1c b1b5f6f7 e3216e83 9f2bfc0f`

## 2) supersede 대사 3점 (07-13 종결 인가 근거, DA 첨부용)

**(a) 트리거 prod live** — §0 실측. has_trigger=true, BEFORE INS/UPD, tgenabled='O'.

**(b) freeze-set ⊇ (07-13 rescope-5 미적용 + 07-14/15 신규 masked) − carve-out — 실증**
- 07-13 rescope-5 잔존(mutation0 확증): `512998d0 67ea1793 bd307dfe 44a6a076 2dc21d1c` → **5/5 전건 freeze-set 잔존** (07-13 prod 무변경 확증)
- CEO 명시 07-14/15 신규 masked: `b1b5f6f7 e3216e83` → **2/2 포섭**
- +1 (07-15 유입) `9f2bfc0f` 포섭
- carve-out 2건 실측 제외(§3)
- ∴ freeze-set = rescope5(5) + 신규(2) + 유입(1) = **8행. 단일 count 아님 — PK 지문 교집합 근거.**

**(c) delta 경위 (freeze2 07-16 → freeze3 07-23)**
- **mutation target delta = 0** — freeze2 mutation target 8 == freeze3 8, **동일 PK 8개**. 소스 봉쇄(트리거 live) 後 신규 마스킹 유입 0 = 트리거 정상 작동 behavioral 확증 (대조: 07-15 pre-seal 시기 `9f2bfc0f` +1 유입 = has_trigger=false 확증이었음).
- **carve-out 2건 지문 이탈 (양성 delta)**: `0356b229`(row1)·`02594dfa` 둘 다 freeze3에서 마스킹 지문 부재. 실측 결과 **둘 다 2026-07-18 11:12 별트랙에서 un-mask 완료**(name_masked=false, updated_at 동일 배치). → ROW1-MASTER-DEFECT/ROW1-DUP-CLEANUP + §2-F 전용 트랙 처리 결과. 본 백필과 무관, carve-out 규약(fold 아닌 자연 제외)과 정합.
- **미규명 delta = 0.**

## 3) carve-out 실측 assert (fold 금지)

- **row1 `0356b229`**: name_star 멤버십 = **false(부재 실측 확인)**. freeze-set 부재. (단정 아닌 실측) → 별트랙 ROW1-MASTER-DEFECT. 추가로 07-18 un-mask 완료 확인.
- **`02594dfa`**: freeze-set 부재. §2-F carry-forward 제외. 07-18 un-mask 완료 확인.
- created_by 有 masked 행: **0** (anon 앵커 밖 유출 없음).

## 4) 행별 2분류 (phantom vs real-polluted) — DA 판정 대상

전 8행: axis=name_star, created_by=NULL, **reservations 참조=0**, live check_ins 보유(실 방문 활동 有 → 삭제형 phantom 아님).

**★ 핵심 신규 발견 — un-mask 소스 CRM 내부 부재:**
8행 전부 `check_ins.customer_name` **스냅샷도 마스킹됨**(`ci_has_clean_name=false` 전건). 마스킹이 anon self-checkin RPC 상류에서 발생해 customers·check_ins 양쪽 전파 → **raw name = CRM 내 복구 불가**.

| PK8 | raw_class | clean twin (동clinic+tail4) | check_ins | resv | 분류 후보 disposition |
|-----|-----------|------------------------------|-----------|------|----------------------|
| 67ea1793 | has_raw_1to1 | **a83a5a9e** (non-masked, len3, tail4 일치) | 1 | 0 | **phantom-duplicate 후보** → archive-first relink(check_ins 1건→a83a5a9e) + 마스킹행 archive. FK 열거: check_ins(1)/reservations(0). |
| 512998d0 | no_raw | 없음 | 1 | 0 | **real-polluted**, raw 소실 → sentinel/외부복구 |
| bd307dfe | no_raw | 없음 | 1 | 0 | real-polluted, raw 소실 → sentinel/외부복구 |
| 44a6a076 | no_raw | 없음 | 2 | 0 | real-polluted, raw 소실 → sentinel/외부복구 |
| 2dc21d1c | no_raw | 없음 | 1 | 0 | real-polluted, raw 소실 → sentinel/외부복구 |
| b1b5f6f7 | no_raw | 없음 | 3 | 0 | real-polluted, raw 소실 → sentinel/외부복구 |
| e3216e83 | no_raw | 없음 | 1 | 0 | real-polluted, raw 소실 → sentinel/외부복구 |
| 9f2bfc0f | no_raw | 없음 | 1 | 0 | real-polluted, raw 소실 → sentinel/외부복구 |

**dev-foot 분류 소견 (DA GO 대상, 미확정):**
- **1행(67ea1793)** = phantom-duplicate 강신호(clean twin 동일 clinic+tail4). → archive-first 2단(relink→archive) + FK RESTRICT 무결성(orphan-row cleanup SOP). 단, 진짜 동일인 확인은 DA/현장 판정.
- **7행** = real-polluted(실 방문 有). check_ins 스냅샷도 마스킹 = un-mask 소스 CRM 내부 부재. phone은 온전(digits 18-22). → **un-mask 불가 → sentinel 처리** 또는 (dopamine/cross-CRM raw 소스 복구 조사)가 DA 판정 필요. 7행 모두 rv=0 순수 walk-in self-checkin → dopamine 리드 linkage 가능성 낮음(조사 필요).

## 5) 게이트 상태

- [x] 하드 의존 해소(has_trigger=true) 실측
- [x] 대상셋 freeze + 판정근거 스냅샷(단일 count 아닌 지문 교집합)
- [x] 행별 phantom/real 분류 신호 + disposition 후보
- [x] carve-out 실측 assert (row1 부재 · 02594dfa 제외)
- [x] delta 경위(c) 규명 (미규명 0)
- [ ] **mutation 실행 CONSULT = DA 재자문 발송** (본 evidence 첨부) ← 다음
- [ ] DA GO + 07-13 close 인가 수신 → MIG-GATE 4필드 + supervisor DB-GATE
- [ ] GO 前 mutation/deploy-ready **금지** (2026-07-14 mutation0 abort 재발 방지)

⚠ 본 패스 mutation 0. deploy-ready 마킹 금지 (DA GO 미수신).
