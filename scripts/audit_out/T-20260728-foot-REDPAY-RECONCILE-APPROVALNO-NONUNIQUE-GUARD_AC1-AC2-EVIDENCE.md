# T-20260728-foot-REDPAY-RECONCILE-APPROVALNO-NONUNIQUE-GUARD — AC-1/AC-2 감사 evidence

**작성**: dev-foot · **일자**: 2026-07-28 · **성격**: READ-ONLY 감사 (write 0, DB변경 없음)
**우선순위**: P0 (MSG-20260728-175759-lvp2 priority-align, responder field-ack P0 정렬)

---

## AC-1 (감사·규명) — approval_no-alone tier 존재 여부

### ✅ 결론: **Tier 0(`findTier0Direct`)가 approval_no 단독 충분조건 tier 다.** (구조적 존재 확인)

**정확한 조건식** (`supabase/functions/redpay-reconcile/matcher.ts` `findTier0Direct`):
```
매칭 성립 = isUnmatchedCrm(p)          // reconciled_at IS NULL AND external_trxid IS NULL
          AND ( p.external_approval_no === raw.approval_no   // ← approval_no 단독 (금액/tid/날짜/윈도 무검사)
             OR p.external_tid          === raw.tid )        // ← tid 단독
          → 후보 1건이면 auto-link, 2건+면 tier4_manual(자동링크 안 함)
```
- Tier 0 의 approval_no 가지는 **amount·tid·approved_at 윈도·KST 날짜를 일절 대조하지 않는다.** → approval_no 비유일(코밴 공식회신) × 다기간 후보풀 = false-merge 벡터. **AC-1 핵심규명 지점 = YES.**
- Tier 1/2/3 는 전부 `amount 일치 + 시간윈도(±15/±30분) 또는 KST 동일날짜`를 강제 → approval_no-alone 아님(안전).

### 경로 커버리지 (runMatcher 5분 cron + 소급백필 양쪽)
- **runMatcher** (`index.ts`): 후보풀 `created_at >= now-14d` 로 **14일 바운드**. Tier 0 대상 = `external_approval_no IS NOT NULL` payments (14d).
- **poller/0728GAP 백필** (`scripts/redpay_macstudio_poller.mjs`): 자체 매칭 없음 → raw upsert 멱등키 = **trxid**(`external_trxid,external_status,amount`) + EF `match_only` 트리거로 동일 4-tier 매처 재사용(무변경). **별도 approval_no-alone dedup 경로 없음** → 위험은 전부 EF Tier 0 에 국소화. (AC-6a 확인: 0728GAP = registry seed + 뷰 retroactive 파생 + EF match_only, approval_no dedup 미사용 — 코드 실측 확정.)

### ★실사용 비율 (최근 30일) — 위험의 **현재 실현도**
| 지표 | 값 |
|------|----|
| 최근 30일 matched raw 중 `tier0_direct` | **0건** (tier3=64, tier1=54, tier2=7) |
| recon_log auto_matched `tier0_direct` (30일) | **0건** (tier3=66, tier1=49, tier2=1) |
| Tier 0 노출면: `external_approval_no` 세팅된 card payments | **0 / 295건** |

→ **Tier 0 approval_no 가지는 현재 prod 에서 단 한 번도 발화하지 않았다.** foot payments 는 `external_approval_no` 를 아무도 채우지 않음(OCR 승인번호 승격 경로 미가동 추정) → Tier 0 approval_no-branch 는 매칭 대상이 0. **위험 = 순수 잠재/구조적** (미실현). external_approval_no 가 채워지기 시작하는 순간(OCR 승격·수기입력) 다기간 백필에서 라이브 false-merge 로 전환.

---

## AC-2 (사후감사 — 진행중 0728GAP 오염 확인) — READ-ONLY

**스크립트**: `T-...-GUARD_ac2_orphanlink_audit.mjs` + `_ac2_refined.mjs`

| 쿼리 | 결과 |
|------|------|
| Q0 matched raw↔payment 링크 규모 | 125건 |
| Q1R **내구성 false-merge 지문**(금액 OR KST날짜 불일치) | **0건** |
| Q4 총괄 예시 approval_no=30024107 (송도) raw 존재 | 0건 (foot merchant 스코프 밖 — 구조적 배제 정상) |
| Q5 같은 approval_no·다른 금액이 둘 다 링크됨(교차오염 실현) | **0건** |

> ⚠ 초판 Q1 은 `tid_mismatch:true` 125건을 표면화했으나 **전량 위양성**: payments 는 `external_tid` 를 대개 NULL 로 두고 `external_trxid` 만 저장 → `pay_tid=NULL` 이 정상. 또한 매처가 링크 시 `payments.external_trxid = raw.external_trxid` 로 덮어씀(`index.ts` L641) → 링크 후 `trxid_mismatch` 항상 false. **내구성 지문 = 매처가 절대 덮어쓰지 않는 amount·created_at(KST date)** 뿐 → 이 두 축으로 재감사 = 0건.

### ✅ AC-2 결론: **CLEAN.** 진행중 0728GAP 백필이 만든 approval_no-alone 오링크 = 0건. (Tier 0 미발화와 정합.) → 정정 follow-up 발번 불요, 현장 긴급알림 불요.

---

## 종합 판정 (dev-foot)

1. **AC-1**: approval_no-alone tier = **Tier 0 존재(구조적 결함 확인)**, 단 최근 30일 실사용 0건 · 노출면 0건 → **잠재 위험**. 가드 하드닝(AC-3/AC-6 trxid-first)은 정당하나 **긴급도(코드변경)는 낮음** — 현시점 실피해 0.
2. **AC-2**: **CLEAN** (오링크 0). 0728GAP 백필 안전.
3. **AC-3/AC-6 하드닝**(trxid 1급키 채택, approval_no-alone 폐기)은 **AC-4 = data-architect CONSULT-REPLY GO 선행 필수**(매칭 predicate = reconcile 정합 SSOT). GO 전 EF predicate 착수 금지. → 별도 CONSULT 발행 예정.
4. 정정(unlink) 대상 = 0 → archive-first cleanup follow-up 불요.

**net**: read-only 감사 완료(코드변경0·DB변경0), P0 긴급성분(진행중 백필 오염) 해소=CLEAN. 하드닝은 DA 게이트 대기.
