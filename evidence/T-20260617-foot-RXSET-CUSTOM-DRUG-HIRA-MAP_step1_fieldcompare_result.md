# Step1 — 총괄 직접등록 대조 결과 (READ-ONLY)

T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP · NEW-TASK MSG-20260718-110243-v9ot #1
실행: 2026-07-18 (PROD rxlomoozakkjesdqjtvd, service_role SELECT only) · **write/DDL/DML 0건**
스크립트: `scripts/T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_step1_fieldcompare.mjs`

## 대상 확정 (매칭 18종 → 이 티켓 apply 후보 17종)

| 구분 | 종수 | 처리 |
|------|------|------|
| v3 매핑표 매칭 | 18 | (#2~#19) |
| 제외 ① 플루나코엠(#1, NONE) | −1 | 별도 티켓 T-20260716-FLUNACOEM-MAP-APPLY로 **이미 PROD 적용 완료** |
| 제외 ② 대웅푸루나졸(#2) | −1 | 총괄 "대웅빼달라고 했음" → 매핑 제외 |
| **이 티켓 apply 후보** | **17** | #3~#19 |

> 참고: 본문 "미반영 18종"은 매칭 라벨(18) 인용. 대웅 제외 시 **실제 apply 대상 = 17종**(FLUNACOEM은 이미 18에서 빠진 NONE분이 아니라 별도 완료분).

## PROD 현 상태

- `prescription_codes` = 519행 = official 500 + custom 19
- official 500 = 기존 499 + **HIRA-201403310**(FLUNACOEM apply로 신규 추가된 official 1건). HIRA- prefix official은 이 1건뿐.
- FLUNACOEM custom(LEGACY-015b55130567) = verified 2026-07-17, mapped→109c78b8(HIRA-201403310), DEPRECATED 링크 = **§8 reference-canonical 정상 적용됨**.

## 17종 대조 결과 (핵심)

| 지표 | 값 |
|------|----|
| custom(자체) row 존속 | **17 / 17 PRESENT** (deprecate 0) |
| provenance 링크(hira_verified/mapped) 有 | **0 / 17** (전부 미링크) |
| **총괄 official 직접등록 감지** (코드 gtin/품목기준코드 또는 이름 정규화 일치) | **0 / 17** |
| 표기변형 부분일치(brand core) 직접등록 | **0 / 17** (보조 스캔 hit 0) |
| 중복 apply 위험(이미 링크/deprecate) | **0 / 17** |

## 판정

- **총괄 "서비스관리 직접등록" = 이 19종 custom(자체) row 자체를 지칭**(약국 대조 후 이름기반으로 서비스관리에 등록한 것). 별도의 **공식 HIRA 코드 등록은 없음**(official 직접등록 0/17, HIRA- official은 FLUNACOEM 1건뿐).
- 따라서 **no-op 종결 대상 아님** — 17종은 여전히 §8 reference-canonical(공식코드 승격) apply가 필요.
- **중복 apply 위험 0** — 이미 반영된 항목 없음, FLUNACOEM(완료)·대웅(제외)만 스코프 밖.

## 다음 단계 (planner apply 여부 판정 회부)

apply GO 시 dev 진행안(§8/§9 메커니즘 = FLUNACOEM 선례 그대로):
1. provenance 4컬럼 DDL = **PROD 이미 존재**(FLUNACOEM DDL 20260716140100로 적용됨) → 추가 DDL 불요, DML만.
2. DML(신규 official ADDITIVE + folder 참조 custom→official 재지정 + custom deprecate=mapped_to 링크) — claim_code in-place 교체 0 / custom hard-delete 0.
3. 다후보 4종 중 대웅 제외 → 잔여 다후보: 에스로반·삼아리도멕스·오구멘토 = "같은 약 규격 선택"(다른 약 지정 아님). 표 규격 1개 확정 필요.
4. 동일 official 다중 custom 참조: 바르토벤(4ml#3/8ml#10), 한미유리아크림(50g#4/20g#9), 주블리아(4ml#14/8ml#16) → official 1건에 custom 2건 링크(신규 official row는 중복생성 방지 dedup).
5. supervisor DML 게이트(GO_WARN, 보험청구코드 직결) + dry-run COUNT + 롤백SQL 스냅샷. dev PROD DB password 미보유 → PROD apply=supervisor.
