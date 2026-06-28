# T-20260629-foot-RXSET-DRUG-EXTDB-VERIFY — AC-2 약품 외부DB 매칭 설계

> **상태**: AC-2 매칭설계 + AC-4 UI(검증배지) 착수분. **DB/DDL/DML/외부 API 무단연결 0**.
> **근거**: planner MSG-20260629-045932-1hly 결정 회신 (소스=HIRA 1안 채택 / 식약처 키발급 승인·2차 직렬화 / AC-2 진행 OK / AC-3 스키마=prescription_codes 클러스터 종료 후 착수, ADDITIVE+DA CONSULT 선행).
> **선행 상속**: AC-1 소스조사(`evidence/...AC1_source_survey.md`, commit 212e8eea) + HIRA-MAP(T-20260617) claim_code namespace.
> **작성**: dev-foot, 2026-06-29.

---

## 0. 설계 전제 (planner 결정 직렬화 반영)

| 결정 | 본 설계 반영 |
|------|------------|
| 소스=HIRA(A 약가마스터 15067462 + B 약제급여목록), 무키 공개파일 | **1차 검증축 = HIRA 2-key(상품명+코드) 무키**. 외부 런타임 호출 0(사전 적재 파일) |
| 식약처(E) = 성분명 **2차 보조축**, 직렬화 | **2차 검증축 = 성분명 식약처 대조**. 1차 게이트 통과 후 비차단 보강 |
| AC-5 fallback 의무 | 식약처 down/timeout/rate-limit → 성분축 `ingredient='unverified'` graceful degrade(에러 아님). **HIRA 1차는 항상 동작** |
| 퍼지·용량표기 자동연결 금지 (drug_identity_rule auto-merge 금지) | 모호 매칭 = **자동연결 안 함 → `unverified`(사람확인)**. 코드/완전일치만 자동 verified |
| AC-3 스키마 보류 | 본 설계는 **검증 판정 로직(순수 함수)·UI 배지(presentational)만** 산출. 검증결과 영속 캐시(스키마)는 AC-3에서 ADDITIVE+DA CONSULT 후 |

---

## 1. 검증 대상 = drug_identity 3-key

drug_identity_rule canon: **상품명 + 성분명 + 코드(claim_code)** 3-key = 약 동일성.
본 티켓은 이 3-key 값을 내부 텍스트가 아니라 외부 공식 source(HIRA/식약처)로 **대조 검증**한다.

| 3-key 축 | 1차 source | 2차 source | 정합 |
|----------|-----------|-----------|------|
| **코드** | A 표준코드(13)/품목기준코드(9) + B EDI코드 | — | `claim_code` 직접 정합(HIRA-MAP §14 namespace) |
| **상품명** | A 한글상품명 | — | 표준코드 master 정규 상품명 |
| **성분명** | (A 부재) | **E 식약처 허가정보 주성분** | 코드정합 불가 → 성분 보강 enrich(비차단) |

---

## 2. 매칭 단계 (2-tier, 코드 우선)

### Tier 1 — 코드 정확매칭 (1급, 자동 verified)
```
our.claim_code (정규화) === HIRA(A/B).code (정규화)
  └ 정규화: trim · 하이픈/공백 제거 · 대문자. EDI bare / std9 / std13 토큰별 비교(HIRA-MAP match_basis 규칙 재사용)
  └ 일치 → 상품명도 HIRA 정규명과 대조(부가확인)
  → 결과: status = 'verified'  (코드 1급 매칭 성공)
```

### Tier 2 — 코드 부재/불일치 시 보조매칭 (partial, 사람확인 권고)
```
코드 없음 OR 코드 불일치
  └ (상품명 + 성분명) 보조 대조:
      · 상품명 정확/정규화 일치 → status = 'partial' (이름대조됨, 코드 미검증)
      · 일치 모호(부분일치·용량표기차이·다중후보) → ❌ 자동연결 금지 → status = 'unverified'
  → 퍼지매칭·용량표기 자동병합 절대 금지(drug_identity_rule auto-merge 금지 정합)
```

### 성분명 2차 축 (식약처 E, 비차단 보강)
```
status ∈ {verified, partial} 인 약에 한해, 식약처(E) 주성분 대조:
  · 성분 일치          → ingredient = 'matched'
  · 성분 불일치        → ingredient = 'mismatch'  (주의 표기, 1차 status 불변경)
  · E down/timeout/미수행 → ingredient = 'unverified'  (AC-5 graceful degrade, 에러 아님)
1차 status 는 성분축 결과로 강등/차단되지 않는다(성분=비차단 보조).
```

---

## 3. 판정 결과 모델 (FE-presentational, **DB enum 아님**)

> ⚠️ 아래는 화면 배지 렌더용 FE 상태 모델이다. **DB 컬럼/enum이 아님** — 검증결과 영속 캐시 스키마는 AC-3에서 data-architect CONSULT 후 별도 확정(추정 스키마 착수 금지). 캐시 스키마 확정 시 이 FE 모델로 매핑.

```
DrugVerifyStatus       = 'verified' | 'partial' | 'unverified' | 'pending'
IngredientVerifyStatus = 'matched'  | 'mismatch' | 'unverified'   // 식약처 2차축
```

| status | 의미 | 배지(teal-emerald) | 사람 액션 |
|--------|------|-------------------|-----------|
| `verified` | HIRA 코드 1급 매칭 | success(emerald) "코드확인" ✓ | 없음 |
| `partial` | 코드 부재→이름대조만 | teal "이름대조" | 코드 확인 권고 |
| `unverified` | 매칭 실패/모호(자동연결 금지) | outline-slate "미확인" | 사람 확인 필요 |
| `pending` | 외부 대조 전/대조 불가 | outline "대조전" | (대기) |

성분축(`ingredient`)은 status 배지 옆 **보조 점/툴팁**으로 부가표기(mismatch=주의색). 1차 배지 색은 바꾸지 않음.

---

## 4. AC-4 UI 배지 — 구현(이번 착수분)

- `src/lib/drugVerification.ts` — §3 모델 + 순수 매핑(라벨·배지 variant·툴팁 문구). 데이터 의존 0, 신규 패키지 0.
- `src/components/doctor/DrugVerifyBadge.tsx` — presentational 배지. 기존 `ui/Badge` variant(success/teal/outline) 재사용. 태블릿 UX(큰 텍스트·툴팁). **검증 데이터 미주입 시 렌더 안 함**(scaffold — 라이브 와이어링은 AC-3 캐시 정착 후).

> **이번 단계 비포함(직렬화 대기)**: HIRA 파일 적재 배치 / 식약처 E API 호출 / 검증결과 캐시 스키마(AC-3) / 페이지 라이브 와이어링. → AC-3 클러스터(prescription_codes RXCODES-WRITE-RLS) 종료 후 후속 NEW-TASK.

---

## 5. 본 단계 무변경/안전 선언

- DB·DDL·DML 0 / 외부 API 무단연결 0 / npm 패키지 추가 0 / 신규 DB enum·컬럼 0.
- 산출 = 설계문서(AC-2) + FE 순수 모델·presentational 배지(AC-4 scaffold).
- 배지는 어떤 라이브 페이지에도 아직 마운트되지 않음 → 현장 노출 동작 없음 → **deploy-ready 마킹 대상 아님**(라이브 와이어링은 AC-3 선행).
