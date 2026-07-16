# T-20260715-foot-MASKPII-CONTAM-BACKFILL — FREEZE 2차 패스 증거 (READ-ONLY)

> 실행: 2026-07-16 (dev-foot, macstudio). `scripts/T-20260715-foot-MASKPII-CONTAM-BACKFILL_freeze2.mjs`
> UPDATE/DELETE/INSERT = **0** (READ-ONLY). PHI 위생(§4): 이름=마스킹형/길이, phone=tail4만. 상세 per-row = off-git.
> ★ 실 정정(mutation)은 DA 재자문 GO + supervisor DB-GATE 후에만. 본 문서는 freeze 스냅샷 전용.

## 지문 (SSOT = `_fn_is_masked_pii` / WS-A 가드 코드 동일)
- **name_star** = name 에 `*` 포함
- **phone_short** = phone 에 `*` 포함 OR phone 유효자릿수 1~7 (tail-only)
- **anchor** = `created_by IS NULL` (anon-RPC 산)
- 단일 count blind UPDATE 금지 → 지문 교집합 + PK freeze + 판정근거 스냅샷.

## FREEZE 결과 (customers 전량 414행 스캔)

- 마스킹 지문 hit = **10행** (전부 `created_by IS NULL`, non-null masked 0건)
- 분류: **name_star 8 / phone_short 2**

| id8 | axis | name(redacted) | tail4 | created_at(UTC) | raw_class | ci | rv | 판정 |
|---|---|---|---|---|---|---|---|---|
| 512998d0 | name_star | \<NAME_STAR\> | 5453 | 07-13 00:32 | has_raw_1to1 | 1 | 0 | mutation 대상 (rescope-5) |
| 67ea1793 | name_star | \<NAME_STAR\> | 0011 | 07-13 05:01 | has_raw_1to1 | 1 | 0 | mutation 대상 (rescope-5) |
| bd307dfe | name_star | \<NAME_STAR\> | 2200 | 07-13 05:02 | has_raw_1to1 | 1 | 0 | mutation 대상 (rescope-5) |
| 44a6a076 | name_star | \<NAME_STAR\> | 1122 | 07-13 05:02 | has_raw_1to1 | 2 | 0 | mutation 대상 (rescope-5) |
| 2dc21d1c | name_star | \<NAME_STAR\> | 0101 | 07-13 05:17 | has_raw_1to1 | 1 | 0 | mutation 대상 (rescope-5) |
| **b1b5f6f7** | name_star | \<NAME_STAR\> | 7754 | **07-14 00:27** | has_raw_1to1 | 2 | 0 | mutation 대상 (CEO 명시 신규) |
| **e3216e83** | name_star | \<NAME_STAR\> | 7887 | **07-14 09:34** | has_raw_1to1 | 1 | 0 | mutation 대상 (CEO 명시 신규) |
| **9f2bfc0f** | name_star | \<NAME_STAR\> | 6635 | **07-15 09:46 (=18:46 KST)** | has_raw_1to1 | 1 | 0 | ⚠ **delta +1** (미enumerate 신규 유입) |
| 0356b229 | phone_short | \<len3\> | 9089 | 07-11 04:09 | has_raw_1to1 | 1 | 0 | **carve-out** (row1, name 비마스킹) |
| 02594dfa | phone_short | \<len4\> | 0000 | 07-13 09:04 | raw_ambiguous(6) | 1 | 0 | **carve-out** (§2-F HOLD) |

## carve-out 실측 assert (✅ 통과)
- **row1 `0356b229`**: name_star 멤버십 = **부재(실측 확인)** ✅ — 마스킹 백필 부적격(name 비마스킹), 별트랙 `ROW1-MASTER-DEFECT`. phone_short 축에서 검출되나 mutation 대상 제외.
- **`02594dfa`**: phone_short 검출 → **§2-F carry-forward 제외** ✅ (raw_ambiguous 6후보 → auto-merge 부적격).
- 두 carve-out = phone_short 2행과 정확히 일치. → mutation 대상은 name_star 축에서만.

## 신규 masked 포섭 assert (CEO MSG-20260716-120729-dne2, ✅)
- `b1b5f6f7` ✅ freeze-set 포섭 / `e3216e83` ✅ freeze-set 포섭.

## supersede 대사 b (07-13 rescope-5 미적용 잔존, ✅)
- rescope-5 5행(512998d0/67ea1793/bd307dfe/44a6a076/2dc21d1c) **전건 잔존** = 07-13 mutation0(prod 무변경) 확증.
- fresh freeze-set ⊇ (rescope-5 5 + 07-14/15 신규 2 + delta 1) − carve-out 2 = **mutation 대상 8행**.

## ⚠ supersede 대사 c — 불일치 delta 경위 (핵심)
- **티켓 명시 = 9행(name_star 7 + phone_short 2)**. **실측 = 10행(name_star 8 + phone_short 2)**.
- **delta = +1 = `9f2bfc0f`** — name_star, created_by NULL, **created 2026-07-15 18:46 KST**.
- 티켓 작성(2026-07-15 01:42 KST) **약 17시간 後** 유입 = 티켓 enumerate 시점 이후 신규 오염.
- **behavioral has_trigger=false 확증**: durable trigger(TRIGGER-DURABLE)는 `deploy-approval-requested`(미배포). masked row `9f2bfc0f`가 07-15 18:46 KST에 정상 persist됨 = 트리거가 있었다면 RAISE 22023로 거부됐을 write가 통과 = **소스 미봉쇄 상태 지속의 직접 증거**(catalog 프로브 불요).
- 함의: e3216e83(07-14, per-RPC 가드 후 재유입)에 이어 `9f2bfc0f`(07-15)까지 = per-RPC(REPRO+R2) approach로 소스 봉쇄 미완. **트리거 선착지 없이 백필 시 정리 직후 재오염 유입 → 2026-07-14 mutation0 abort 재발 리스크**.

## 분류 prep (phantom vs real-polluted — DA GO 후 확정)
- mutation 대상 8행 전부 `raw_class = has_raw_1to1` (동일 clinic + tail4 일치 non-masked raw 1건 대응) + `ref_reservations = 0`.
- = 07-13 판정과 동형: self_checkin phantom(resv_id NULL 생성) + raw 1:1 recovery. → **phantom(archive-first relink + FK 열거)** 우세, un-mask(rename-in-place)는 중복행 잔존으로 별도. 최종 분류/방식 = DA 재자문 판정 대기.

## 산출물
- git-tracked(PHI-free): `db-gate/T-20260715-foot-MASKPII-CONTAM-BACKFILL_freeze2_evidence.json` + 본 md.
- off-git 판정근거 스냅샷(PHI 라우팅 §4): `~/foot-phi-offgit/T-20260715-foot-MASKPII-CONTAM-BACKFILL_freeze2_confirm.json`.

## 게이트 상태
- ✅ freeze READ-ONLY prep 완료 (mutation 0).
- ⏳ 실행 CONSULT = DA 재자문 발송 (본 증거 첨부).
- ⛔ GO 前 mutation/MIG-GATE 4필드/deploy-ready **금지 유지**.
