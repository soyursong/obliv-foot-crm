# 런북 — 건강보험 수가 연례 개정 대응 (환산지수·상대가치점수)

> **성격: docs 전용 운영 절차서.** 이 파일 자체는 코드/RPC/DB를 변경하지 않는다(완전 가역).
> **실제 개정 실행은 이 런북이 아니라 별도 티켓에서 한다** — 아래 §5 참조 (`db_change=true` + DA CONSULT 선행 필수).

- 신설 티켓: `T-20260722-foot-HIRA-ANNUAL-REVISION-RUNBOOK` (P2)
- parent: `T-20260722-foot-HIRA-SCORE-GONGDAN-4SVC-LOAD` (Part C 분리)
- 인접 참조: `T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE`(환산지수 산식 본체, deployed) · `T-20260714-foot-HIRA-CITATIONS-DOC`(근거 아카이빙, `docs/citations/health_insurance.md`)
- 대상 독자: 매년 초 심평원(HIRA)·복지부 고시 반영을 실행하는 dev-foot + supervisor
- last_reviewed: 2026-07-22

---

## 0. 왜 이 런북이 필요한가 (배경)

상대가치점수·환산지수는 **매년 개정**된다(심평원/복지부 고시). 한 번 값을 박고 끝이 아니라, 매년 초 신년도 고시를 반영하는 **반복 유지 절차**가 필요하다. 이 문서는 그 절차를 고정해 매년 동일하게 재현 가능하도록 한다.

핵심 원칙 3가지:

1. **환산지수는 year-stamp config로 이미 설계돼 있다** → 연례 갱신 = 두 필드만 UPDATE.
2. **과거 발행 서류·정산은 개정 후에도 절대 불변**(forward-only) — `service_charges`가 결제 시점 스냅샷을 보존한다.
3. **화면(점수 기반)과 서류(price 기반)의 드리프트를 매년 재산정으로 막는다** (§3.3이 이 런북의 심장).

---

## 1. 현 인프라 (실측 기준, 개정 대상 필드)

### 1.1 환산지수 — `clinics` 테이블 (year-stamp config)

| 컬럼 | 타입 | 현재값 | 정의 |
|------|------|--------|------|
| `clinics.hira_unit_value` | `NUMERIC(8,2)` | **95.60** | HIRA 환산지수(점수당 원). 의원 종별 단일값. |
| `clinics.hira_unit_value_year` | `INT` | **2026** | 환산지수 적용 연도 |

- 출처 마이그레이션: `supabase/migrations/20260504000000_insurance_copayment.sql` (컬럼 정의, COMMENT에 "매년 변경" 명시) → `20260714110000_clinics_hira_unit_value_2026_governed.sql` (2026=95.60 governed 반영).
- **연례 갱신 = 이 두 필드만 UPDATE.** 별도 스키마 변경·RPC 분기 불요.
- ⚠️ 환산지수는 **기관 종별로만** 나뉜다(의원 단일값). 행위유형(검사/영상)별 별도 환산지수는 없다 — 2026 고시 제2025-186호 확정. (과거 "검체검사 환산지수 110" 은 순환오류였음, 정정 완료.)

### 1.2 상대가치점수 — `services.hira_score`

- 급여 서비스의 소정점수(상대가치점수)를 `services.hira_score`(NUMERIC)에 저장한다.
- **연도 스탬프 없음** — 서비스 행에는 "현행 점수"만 산다. (과거 시점 점수는 아래 service_charges 스냅샷이 보존.)
- 현재 active 급여 4개 적재값 (parent 티켓 Part A):

  | svc_code | 명칭 | price | hira_score | 검산(×95.6) |
  |---|---|---|---|---|
  | AA154 | 초진진찰료-의원 | 18,840 | 197.07 | =18,840 ✅ |
  | AA254 | 재진진찰료-의원 | 13,370 | 139.85 | =13,370 ✅ |
  | AA222 | 재진-물리치료·주사 등 | 4,690 | 49.09 | ≈4,690 ✅ |
  | D620300HZ | 일반진균검사-KOH도말 | 10,540 | 110.20 | =10,535→10,540 ✅ |

### 1.3 과거 서류·정산 불변 보장 (개정해도 안전한 이유)

- `service_charges`가 **결제 시점의 등급 + 환산지수(연도) + 점수 스냅샷**을 보존한다 (`service_charges.hira_unit_value_year` 등, `20260715160000_foot_consultfee_writepath_insurance.sql`).
- 따라서 신년도 값으로 `clinics`/`services`를 UPDATE 해도 **이미 발행된 서류·정산 금액은 바뀌지 않는다.**
- 🚫 **금지: 과거 `service_charges`/`payments` 행 소급 UPDATE 절대 금지** (forward-only). 이는 여러 마이그레이션에 명문화된 불변식이다("소급 = 범위 밖. 기존 service_charges/payments 행 UPDATE 절대 금지").

### 1.4 계산 경로 2개 (드리프트가 생기는 구조적 이유)

| 경로 | 산식 | 근거 |
|------|------|------|
| **화면 자동산정** (`calc_copayment` RPC) | `v_base = ROUND(hira_score × hira_unit_value)` | 점수 기반 |
| **서류·영수 금액** (`computeFootBilling`) | `services.price` **직접 사용** | price 기반 |

→ **두 계산기가 서로 다른 소스**를 쓴다. 환산지수가 바뀌면 화면(점수×신환산지수)은 새 금액으로 움직이지만, 서류(price)는 price를 갱신하지 않으면 **옛 금액에 멈춘다** = 드리프트. §3.3이 이를 막는다.

---

## 2. 갱신 전 준비 (매년 초, 실행 티켓 착수 前)

1. **신년도 고시 원문 확보**
   - 의원 종별 **환산지수**: 복지부 고시(예: 2026=제2025-186호「건강보험요양급여비용의 내역」). 국민건강보험공단/복지부 공고 원문 URL 확보.
   - **상대가치점수** 개정분: 심평원 상대가치점수 개정 고시. 변경된 항목 코드·신점수 목록화.
2. **근거 아카이빙 (docs/citations)**
   - 신년도 환산지수·개정 점수를 `docs/citations/health_insurance.md`에 **원문 그대로** append 블록으로 추가. 요약·의역·날조 금지, 미검출은 "미검출"로 정직 기록. (citations 컨벤션: `docs/citations/README.md`)
   - 값이 바뀐 citation은 기존 파일 보존 + 새 id로 신규 파일, 기존 상단 `superseded_by:` 표기.
3. **⚠️ 검체검사 소정점수 재확인 (2026 상시조정 경고)**
   - **검체검사 소정점수는 2026 연중 하향 상시조정이 추진 중**이다(복지부, 원가 대비 192% 과보상 분석). `D620300HZ`(KOH도말) 등 **검사 계열 점수는 연초 고시 외에도 연중에 바뀔 수 있다.**
   - → **배포 직전 반드시 최신 고시를 재확인**한다. 연초에 확인한 값이라도 배포 시점 기준 최신 고시와 재대조 후 반영. (연초값을 그대로 믿고 배포 금지.)

---

## 3. 갱신 실행 절차 (실행 티켓 안에서 수행 — §5 게이트 통과 후)

> 아래는 **실행 티켓(`db_change=true`, DA CONSULT 완료)**에서 수행할 마이그레이션 단계다. 이 런북 자체는 실행하지 않는다.

### 3.1 환산지수 갱신 — `clinics` 두 필드 UPDATE

```sql
-- 예시(신년도 값·연도로 치환). 반드시 dry-run + rollback SQL 동반.
UPDATE clinics
SET hira_unit_value      = <신년도 의원 환산지수>,   -- 예: 2027년 고시값
    hira_unit_value_year = <신년도>                  -- 예: 2027
WHERE slug = 'jongno-foot';   -- 대상 클리닉 스코프 명시 (SCOPE_GUARD 준수)
-- 검증: rows-affected = 1 확인 (0-row silent-fail 금지, Cross-CRM write 검증 표준)
```

- COMMENT/마이그 헤더에 **source(고시번호·고시명)·적용연도·확인 URL·retrieved_at** 주석 필수.
- 스키마 변경 아님(값 UPDATE만) — 그래도 신규 컬럼/enum이 아니므로 DA CONSULT는 §5 데이터 정책 게이트 판단에 따른다(값 변경도 DA 자문 권장).

### 3.2 상대가치점수 갱신 — 변경된 `services.hira_score`만 UPDATE

```sql
-- 개정분이 있는 항목만. 변경 없는 항목은 손대지 않는다.
UPDATE services
SET hira_score = <신 소정점수>
WHERE svc_code = '<대상코드>' AND is_insurance_covered = true AND active = true;
-- 검증: rows-affected 기대치 일치 확인
```

- **source 주석 필수**: 심평원 코드·소정점수·**적용 고시번호/연도**·출처 URL.
- 🚫 **price 변경 금지 지점 아님** — price 재산정은 §3.3에서 별도로, 의식적으로 수행한다.
- 🚫 비활성(`active=false`) 서비스는 대상 아님(라이브 무관) — 함부로 삭제/수정 금지.
- 🚫 `is_insurance_covered`·`active` 플래그 변경 금지(별건).

### 3.3 ★ price ↔ (hira_score × 환산지수) 정합 재산정 (드리프트 방지 — 이 런북의 핵심)

환산지수 또는 점수가 바뀌면 **`services.price`도 신 산식으로 재산정**해야 화면(점수 기반)과 서류(price 기반)가 일치한다.

```
신 price = ROUND(신 hira_score × 신 hira_unit_value)   -- 10원 반올림, RPC v_base와 동일 규칙
```

- 예(2026): AA154 = 197.07 × 95.60 = 18,840 → `price = 18,840`.
- **환산지수만 바뀌어도 모든 급여 항목 price를 재산정**해야 한다(점수 불변이어도 곱이 바뀜).
- 재산정 후 **화면 v_base(`ROUND(hira_score×hira_unit_value)`)와 서류 price가 원 단위까지 일치**하는지 대조.
- ⚠️ 반올림 규칙 일치 주의: RPC는 `ROUND(...)`(10원 반올림). price도 동일 규칙으로 산출해 1의 자리 드리프트 방지.

> **설계 개선 후보(별건):** 장기적으로 price를 `hira_score × hira_unit_value`에서 **파생(단일 소스화)**하면 이 수동 재산정 단계가 근원 소멸한다. 이 클리닉은 건보청구 미수행이라 점수 provenance가 필수는 아니므로, 화면도 price 기반으로 통일하는 방안도 검토 가치가 있다. **본 런북 범위 밖 — 별도 설계 티켓.**

### 3.4 서류 시점 스냅샷 무영향 재확인

- `service_charges.hira_unit_value_year` 등 스냅샷 컬럼은 결제 시점에 채워지므로, 신규 결제부터 신년도 값이 자연히 스냅샷된다. **과거 행 소급 UPDATE 금지**(§1.3).

---

## 4. 갱신 후 검증 (배포 verify — 화면·서류 금액 일치 실측)

대표 급여 항목으로 **실제 화면·서류 금액이 일치**하는지 실측한다:

1. **화면 자동산정(`calc_copayment` RPC)** — 대표 급여 4개(AA154/AA254/AA222/D620300HZ 등)에 대해:
   - `base_amount`(v_base) = 신 `hira_score × hira_unit_value` ROUND 값과 일치.
   - 공단 부담 non-zero, 등급별 본인부담(30/70 등) 정상.
2. **서류·영수(`computeFootBilling`)** — 동일 항목 서류 발행 금액이 §3.3 재산정 price와 일치.
3. **화면 금액 == 서류 금액** — 두 경로가 원 단위까지 동일(드리프트 0) 확인. **불일치 시 §3.3 재산정 누락**을 의심하고 재작업.
4. 신년도 `clinics.hira_unit_value_year`가 신년도로 갱신됐는지 확인.
5. 과거 발행 서류 1건 샘플 재열람 → **금액 불변**(스냅샷 보존) 확인.

---

## 5. 실행 게이트 (이 런북으로 직접 개정하지 말 것)

**실제 개정 실행은 반드시 별도 티켓으로 한다.** 본 런북은 절차 문서일 뿐이며, 다음을 만족하는 실행 티켓에서만 값을 바꾼다:

- [ ] **`db_change=true`** 티켓 (clinics/services 값 UPDATE = DB 변경).
- [ ] **DA(data-architect) CONSULT 선행** — 데이터 정책 자문 게이트(`agent_collaboration_rules.md §S2.4`). CONSULT 미선행 시 deploy-ready 금지.
- [ ] **dry-run + rollback SQL 동반** (개발 DB 자율 SQL 필수 조건).
- [ ] 마이그레이션 헤더에 source(고시번호·연도·URL·retrieved_at) 주석.
- [ ] §4 배포 verify(화면·서류 금액 일치 실측) 통과 후 deploy-ready.

### 향후 자동화(별건)

- 심평원 수가 API / 건보 자동조회(`T-20260722-foot-NHIS-AUTOLOOKUP-DESIGN`)와 연동하면 이 연례 수동 절차의 상당 부분을 자동화할 수 있다. 본 런북 범위 밖.

---

## 부록 A. 연례 체크리스트 (복사해서 매년 실행 티켓에 붙여 사용)

```
[ ] 신년도 의원 환산지수 고시 원문 확보 (고시번호·URL·retrieved_at)
[ ] 상대가치점수 개정분 목록화 (변경 항목 코드·신점수)
[ ] ⚠️ 검체검사(D620300HZ 등) 점수 — 배포 직전 최신 고시 재확인 (연중 상시조정)
[ ] docs/citations/health_insurance.md 에 신년도 근거 append (원문 그대로)
[ ] 실행 티켓 개설: db_change=true + DA CONSULT
[ ] clinics.hira_unit_value + _year UPDATE (source 주석, rows-affected=1)
[ ] 변경된 services.hira_score UPDATE (source 주석)
[ ] ★ services.price 재산정 = ROUND(hira_score × hira_unit_value) — 전 급여항목
[ ] dry-run + rollback SQL 확인
[ ] verify: 화면 v_base == 서류 price == 재산정값 (대표 4항목 실측)
[ ] verify: 과거 발행 서류 금액 불변 (스냅샷 보존) 샘플 확인
[ ] deploy-ready 마킹 (frontmatter 5필드)
```
