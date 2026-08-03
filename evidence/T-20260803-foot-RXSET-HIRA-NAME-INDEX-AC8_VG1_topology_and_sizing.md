# AC-8 코퍼스 사이징 + VG-1 query-path topology 결정 (dev-foot)

- **ticket**: T-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8
- **DA decision**: DA-20260803-foot-RXSET-HIRA-NAME-INDEX-AC8 (GO / Option A / ADDITIVE)
- **SSOT**: da_decision_foot_rxset_hira_name_index_ac8_20260803.md
- **date**: 2026-08-03 · **author**: dev-foot

DA §8 ball(1): "AC-1 source A 기준 코퍼스 사이징 + VG-1 query-path topology 확정".

---

## 1. 코퍼스 사이징 (AC-1 source A = data.go.kr 15067462)

- source A = 건강보험심사평가원 의약품 품목 유니버스(품목기준코드9 namespace).
- 규모 = **수만 행 order(전 시판 의약품 품목)** — prescription_codes 병원 카탈로그(~499 official)와 **2~3 order 차이**.
- 결과: **FE bounded 로드 비현실**. 매 처방 화면에서 수만 행(정규화명 포함) 페이로드를 내려받는 것은
  태블릿 UX(§9 큰 버튼·현장 속도)에 부적합.

## 2. VG-1 topology 결정 — **(ii) 서버-side lookup**

| 후보 | 판정 | 근거 |
|------|------|------|
| (i) FE bounded 인덱스 로드 | **REJECT** | 코퍼스 수만 행 → 페이로드/메모리 비현실 |
| (ii) 서버-side lookup(SECDEF RPC staff-facing·REVOKE anon or EF) | **채택(forward)** | trigram GIN 인덱스를 DB-side 에서 활용, 후보검색+정확일치 판정 |

- 조회부는 **staff-facing SECDEF RPC**(authenticated only·REVOKE anon)로 착지 예정 —
  정규화 질의(공용 `normalizeHiraDrugName`)로 trigram 후보 조회 후 **정확일치 규칙**(AC-2:
  정확일치=partial / 모호=unverified)을 상위에 적용.

## 3. ★AC-8 범위 경계 (VG-4 준수) — 이 티켓은 코퍼스만

- **AC-8 = 코퍼스 적재만**(신규 테이블 + GIN trigram + RLS + 멱등 import). partial 활성화·verdict
  backfill **안 함**. `computeDrugVerifyVerdict` 무변경 → AC-3 캐시와 double-governance 없음.
- **VG-1 의 조회 RPC/partial 활성화 = forward read-path = 별도 후속 트랙**. 그 트랙은 신규 SECDEF
  RPC 로 착지하므로 **DA 재-CONSULT 트리거 (b)**(query-path 신규 SECDEF RPC 착지 = pin 판정) 해당.
  → **본 AC-8 에서 조회 RPC 를 만들지 않는다.** 코퍼스 적재 완료 후 planner 경유로 후속 티켓 +
  DA 재-CONSULT(b) 를 개시한다.

## 4. 후속(planner FOLLOWUP)

1. 코퍼스 prod 적재(supervisor MIG-GATE) 후 →
2. partial 활성화 트랙: SECDEF lookup RPC 설계 → **DA 재-CONSULT (b)** → 구현.
   - 이 트랙은 처방 화면(의사 영역) 배지에 partial 을 노출 → **§11 의료화면 컨펌 게이트** 사전 확인 필요.
