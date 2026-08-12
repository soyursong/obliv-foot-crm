# T-20260813-foot-OUTPATIENT-MGMTFEE-BYLAW1-EDITION-SCOPE — 조사 회신 (leg A byte-source)

- **판정: leg A(외래관리료 byte-source 분해표) 확정. READ-ONLY 조사, prod write 0.**
- 실행일: 2026-08-13 / dev-foot
- artifact_class: ops_only (조사 회신 evidence · 코드/DB/배포 산출물 0)
- 부모: T-20260813-foot-SURCHARGE-SRCCLOSE-PMWCHECKOUT (computeSurcharge 산식 go-live HARD gate)
- DA canon: `ROUND((기본진찰료점수 × 1.3 + 외래관리료점수) × edition_환산지수)` 원미만 4사5입 (MSG-20260813-013118-fzjr Q3)

---

## 1. 결론 요약 (분해표 — leg A DoD)

진찰료 = **기본진찰료**(가산 ×1.3 대상) + **외래관리료**(가산 제외 ×1.0). 야간·공휴일·토요 30% 가산은
**기본진찰료 소정점수에만** 적용(외래관리료 제외). 외래관리료는 *파생값*(= 진찰료 총점 − 기본진찰료).

| 코드 | 명칭 | 진찰료 총점(hira_score, prod LIVE) | 기본진찰료 소정점수 (가산 ×1.3) | 외래관리료 점수 (파생 = 총점−기본, ×1.0) | 분해 가능 | 가산 eligibility |
|------|------|------|------|------|------|------|
| **AA154** | 초진진찰료-의원 | **197.12** | **155.57** | **41.55** (197.12−155.57) | YES | eligible |
| **AA254** | 재진진찰료-의원 | **139.85** | **98.03** | **41.82** (139.85−98.03) | YES | eligible |
| **AA222** | 재진 물리치료·주사 등 의사 진찰없이(=동일처방/진료없음) | **49.09** | **N/A (단일 정액)** | **N/A** | **NO(flat)** | ⚠ legal §30-4 |
| M0111 | 단순처치 [1일] | 75.51 | — (처치료, 진찰료 아님) | — | 진찰료 축 밖 | 가산 진찰료축 무관 |

**환산지수(clinics.hira_unit_value) prod LIVE = 95.60 (2026, governed).** 89.40 = stale(제거됨) · 94.1 = 2025.

---

## 2. Byte-source (1차 자료 — 발명 0건, 순환검증 0건)

- **심평원 「건강보험요양급여비용」 2026년 1월판** (발간등록번호 G000A37-2026-10)
  - 수록 고시: 보건복지부고시 **제2025-186호**(요양급여비용의 내역) · **제2025-249호**(행위 급여·비급여 목록표 및 급여 상대가치점수)
  - PDF: `https://www.hira.or.kr/ebooksc/2026/02/BZ202602273023260.pdf`
- **기본진찰료 소정점수 출처 = 제2부 제1장 기본진료료 [산정지침] 1. 진찰료 가.(1) 원문 verbatim** (책 p.67~68):
  > 진찰료는 **기본진찰료**(초진의 경우 **AA153~AA157은 155.57점** … **재진의 경우 AA253~AA257은 98.03점** …)와
  > **외래관리료(진찰료에서 기본진찰료를 제외한 점수)**의 소정점수를 **합하여** 산정한다.
  - 가.(7): 기본진찰료 = 병원관리·진찰권발급 등 / 외래관리료 = 외래환자의 처방 등.
- **진찰료 총점 출처 = 제1절 기본진료료 가-1 외래환자 진찰료 점수표** (책 p.87~89): AA154(의원 초진)=197.12 · AA254(의원 재진)=139.85.
- **AA222 출처 = 가-1 재진 주6 원문 verbatim**: "물리치료, 주사 등을 일시에 처방 지시하여 의사의 진찰행위 없이 … **49.09점**을 산정한다" → **단일 정액**(기본/외래관리 구조 아님).
- **cross-CRM 정합**: 동일 요양기관(13328581) sibling `T-20260812-body-EXAMFEE-BASE-SCORE-MASTER` 가 동일 고시 원문에서 동일값(155.57/98.03, AA222=NULL) 접지 (da_consult_ref: DA-20260812-body-EXAMFEE-BASE-SCORE-MASTER, CONDITIONAL-GO ADDITIVE). national 상대가치점수 = center-independent → foot/body 동일.
- **AA222 foot-도메인 접지**: 대한임상피부치료연구회(대피연) — "의사 진찰행위 없이 반복 내원하여 **발톱무좀레이저**·주사·광선치료·물리치료를 받는 경우 AA222 사용" → foot(발톱) 현장 정확 대응. foot seed-comment 라벨('물리치료 재진')과 body 라벨('동일처방/진료없음')은 **동일 코드 AA222**(라벨 상이·값 동일).

---

## 3. edition 현행성 (leg A 실측 anchor / leg B = legal §30-4)

- **기본진찰료 소정점수(155.57/98.03)는 edition-stable**: 진찰료 총점 188.11→197.12(초진)·134.47→139.85(재진) 증가는 **전량 외래관리료 증가분**이며 기본진찰료는 무변(고시 산정지침 값 불변). ∴ 가산 base(기본진찰료)는 edition drift에 둔감, 외래관리료(파생)만 edition-따라 변동.
- **근거 판본 = 고시 제2025-249호.** supervisor §30-6 AUTHORITY gate 가 **현행 제2026-153호 개정 4항목 = 진찰료 무접촉**으로 155.57/98.03 현행성 독립 확증(body DB-GATE evidence §3). 국가법령정보센터 시행 2026-07-01 = 제2026-134호(도수 관리급여 전환·진찰료 점수 무변).
- **⚠ leg B (legal §30-4, dev-foot 소관 아님)**: terminal 고시번호 확정 + AA154/AA254 기본진찰료 무변 verbatim + 저계상 window 소급 적용 edition = **agent-legal CONSULT**(responder relay). body 발주측(이은상 팀장)도 동일 terminal-verbatim 을 formal gate 로 요구 중 → 동일 legal 게이트로 수렴.
- **순환검증 주의(부모 구현 시)**: `197.12 × 95.6 = 18,844.67` / `18,845 ÷ 95.6 = 197.12` — 총점이 역산 지문과 구별 안 됨. 부모 구현 착수 시 총점 197.12·139.85 를 **고시 점수표 원문으로 직접 재확인**(prod 저장값 일치를 근거로 쓰지 말 것).

---

## 4. 부모(computeSurcharge) 구현 입력 — 산식 mirror

DA canon `ROUND((기본×1.3 + 외래관리)×unit)` 대수 정리(외래관리 = 총점−기본):
```
surchargedConsultAmount = ROUND( (hira_score + base_consult_score × rate) × hira_unit_value )
                        # 원미만 4사5입 (ROUND1, foot §2-2-1d canon) · rate = 0.3 (야간/공휴일/토요)
```
- **필요 신규 atom = base_consult_score 단 1개** (AA154=155.57 / AA254=98.03 / AA222=NULL). 외래관리료는 **저장하지 말 것**(파생 = 총점−기본).
- foot 과가산 site = **`src/lib/footBilling.ts:422`** `Math.round(svc.hira_score * hiraUnitValue * (1 + surchargeRate))` — 현재 **총점(기본+외래관리)에 blanket ×1.3** = 외래관리료 과가산(DA CRITICAL over-billing). 정정 = 위 산식으로 base-consult scope 한정.
- **⚠ 외래관리료는 PER-CODE 파생**: 초진 41.55 ≠ 재진 41.82 (0.27점 차 = 고시 실측값, 오류 아님). shared constant 가정 금지 — 코드별 (총점−기본)로 산출.
- **⚠ AA222**: 단일 정액 49.09 → naive ×1.3 금지. 분해 base 부재 + 진찰 없음(무진찰). 가산 eligibility·산정방식 = **legal §30-4 + DA(부모 산식)** 판정 대상. base_consult_score = NULL 유지(body 선례).
- **⚠ ROUND grain**: foot = **ROUND1**(원미만 4사5입, DA Q3 canon). body 의 round10(초진 가산 23,310 등) 숫자를 그대로 복사 금지 — foot 은 `ROUND((197.12+155.57×0.3)×95.6)=ROUND(23,306.4)=23,306` (ROUND1).
- **환산지수 폴백 hazard**: 잔존 `COALESCE(hira_unit_value, 89.4)` 폴백 = latent(stale 89.4). 부모 구현 시 fail-closed(폴백 제거/BLOCK).
- **schema 선례**: body 는 `services.base_consult_score` nullable NUMERIC 컬럼 신설(ADDITIVE, DA CONSULT 경유). foot 도 동형이면 §S2.4 DA CONSULT(스키마 게이트) 선행 — 부모 구현 소관.

---

## 5. DoD 충족

- [x] **A**: 대상 진찰료 코드별 (기본진찰료 점수, 외래관리료 점수, 환산지수) 분해표 확정 → 부모 티켓 입력(§4). naive AA% blanket 회피(AA222 flat 분리·외래관리 per-code 파생).
- [ ] **B**: legal §30-4 edition 현행성 + 소급 적용 edition — **agent-legal CONSULT 필요**(dev-foot 소관 아님, planner→responder relay). 실측 anchor(§3) 동봉.
- [→] 부모 sequencing step 2 해소 통지 = planner FOLLOWUP 발행(본 조사와 동시).

## 6. 배포 영향
- prod write **0건**(READ-ONLY 조사). CF Pages 재배포 불요. 현장 무영향. supervisor DB-gate 불요.
