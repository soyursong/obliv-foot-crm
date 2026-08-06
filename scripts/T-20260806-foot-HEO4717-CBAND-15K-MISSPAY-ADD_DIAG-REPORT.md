# T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD — AC-0 CENSUS 리포트 (READ-ONLY)

**작성**: dev-foot / 2026-08-06 · **범위**: AC-0 DIAGNOSE-FIRST (⛔ prod WRITE/DELETE/DDL 0, 전량 SELECT)
**제보**: 김주연 총괄 (U0ATDB587PV, C0ATE5P6JTH) · MSG-20260806-095046-gyzd
**대상**: 현은호 / 차트 **F-4717** / customer_id=`6412fbf7-8a53-4d49-af7a-491e1d731b4c` / clinic=`74967aea…930bc8`
**항목**: "케어 토어 밴드 15,000원(카드)" 결제 누락 1건 record 요청
**증적 러너**: `scripts/T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD_ac0_census.mjs`

**인증 컨텍스트(명시)**: Supabase Management API `/database/query` (SUPABASE_ACCESS_TOKEN) = service_role 상당 full-access, **RLS 미적용** → 반환 0-row = "RLS 차단"이 아니라 **실 데이터 부재**로 해석함. (진단 인증컨텍스트 표준 준수 · 0-row 오독 방지.)

---

## 상품 식별
- **Care Toe Band (CTB)** = `services.id=e17ba3a3-4842-4097-87bc-0778a64d2755`, **price 15,000**, category=기타/`풋화장품`, service_type=single, clinic=74967aea, active=true. → 케어토어밴드 = CTB(풋화장품 소매성 항목), 정가 15,000 확정.

## F-4717 방문(check_ins) 이력
| created_date | status | visit_type | check_in id |
|---|---|---|---|
| 2026-07-20 | done | new | 6151b3b3 |
| 2026-07-28 | cancelled | new | 5b21a6db |
| 2026-07-28 | done | returning | c33dfc76 |
| 2026-08-05 | done | returning | 526e0aa8 |

---

## 3자(+VAN) 대조 결과

### ① payments(원장②, VAN 대사) — amount=15,000: **0건**
F-4717 payments 5행: 8,800(07-20 card) / 5,760,000(07-28 재결제 card, pkg 링크됨) / 1,400(07-28) / 240,000(07-28) / 240,000 refund(07-28). **15,000 없음.**

### ② package_payments(원장①) — amount=15,000: **0건**
24회권(5,760,000) 결제/환불 leg만 존재. **15,000 없음.**

### ③ check_in_services / service_charges — CTB·15,000: **0건**
어느 check_in 에도 Care Toe Band 서비스라인/명세 **없음**. (08-05 방문 명세 = 재진 물리치료 copay 1,400 + 비가열성 진균증 레이저 240,000. CTB 라인 부재.)

### ④ redpay_raw_transactions(VAN raw) — clinic 내 amount=15,000: **총 12건 / 미매칭(유효승인) 5건**
| approved_at (UTC) | ext_status | approval_no | matched_payment_id |
|---|---|---|---|
| 2026-07-18 02:57:42 | Y | 00638668 | **NULL(미매칭)** |
| 2026-07-24 08:48:29 | Y | 30031186 | c54afcae (매칭) |
| 2026-07-25 09:28:13 | Y | 30021264 | **NULL(미매칭)** |
| 2026-07-27 07:38:39 | Y | 30065786 | **NULL(미매칭)** (07-27 동일 approval_no 취소(N)행 1건 존재) |
| 2026-07-29 06:28:47 | Y | 84424943 | **NULL(미매칭)** |
| 2026-07-29 09:27:48 | Y | 00041373 | **NULL(미매칭)** |
| 2026-07-30~08-04 | Y | (5건) | 전부 매칭됨 |

→ **미매칭 5건은 07-18 / 07-25 / 07-27 / 07-29×2** — F-4717 방문일(07-20·07-28·08-05) 중 **어느 날짜와도 일치하지 않음.** VAN raw 는 고객 링크가 없어(clinic 단위 raw) 특정 승인을 F-4717에 데이터만으로 귀속 불가.

---

## 판정 (census 사실만 — write target 판정 아님)

1. **CRM 내 진성 미기록 확정**: 케어토어밴드 15,000 카드 결제는 F-4717 의 payments·package_payments·check_in_services·service_charges **전 원장/라인에서 0건**. → **현 시점 이중-INSERT 위험 없음**(①=0), 요청대로 "record만 누락"과 정합.

2. **⚠ 그러나 "실 결제 완료" 를 redpay 로 독립 확증 불가**: 미매칭 15,000 VAN 승인 5건은 존재하나 **전부 F-4717 방문일 밖**(07-18/25/27/29). F-4717 실제 방문일(07-20/28/08-05) 에는 15,000 VAN 승인이 **아예 없음**. → 특정 VAN 승인을 F-4717 CTB로 귀속할 데이터 근거 부재.

3. **→ 결제 일자/단말 현장 재확인이 write 전 필수(블로커)**. 이유: 임의 일자로 payments INSERT 시 (a) 실제로는 다른 고객의 미매칭 15,000 VAN 승인을 F-4717 결제로 오귀속 → **VAN 대사 이중귀속 오염** 위험, (b) VAN 근거 없이 record 시 매출은 +15,000 되나 레드페이 대조에서 orphan 발생. 결제 일자가 특정되면 해당 일 VAN 승인(미매칭)과 매칭하여 안전 record 가능.

---

## 선행 4717 선례 대조 (T-20260728-VISITTYPE-HEO-4717)
- 선행 건: payments INSERT 가 이미 존재한 원장 때문에 **이중계상 위험**으로 폐기 → check_in status 승격 대체. **본 건은 반대** — 15,000 은 어느 원장에도 **부재**(진성 누락). 이중계상 벡터는 "이미 존재"가 아니라 **"VAN 오귀속"** 쪽. write target 은 VAN 링크 정합을 반드시 포함해야 함(DA CONSULT gate).

## 다음 단계 (착수 금지 — 게이트 대기)
- **planner FOLLOWUP**: 본 census + 결제일자 미상 블로커 → responder 경유 김주연 총괄 재확인(어느 방문/일자에 CTB 15,000 카드 결제했는지).
- **AC-1 DA CONSULT (data-architect)**: 정확한 write target(payments INSERT[+VAN 링크] vs 레드페이 대조누락 보정) + 이중계상(VAN 오귀속) 방지 불변식. **DA GO 전 실 write 0.**

**DB 변경**: 없음(AC-0 전량 READ-ONLY). **DA CONSULT**: AC-1 에서 REQUIRED.
