# T-20260725-body-FOOT-EXAMFEE-HIRA-2026-APPLIED-CROSSCHECK — READ-ONLY cross-check evidence

- domain: body(origin) / target_system: obliv-foot-crm
- 요청: 김나영 도수 센터장 (도수 진찰료 락 saga 후속) — "풋 진찰료가 2026 개정안으로 안 보인다. 로직/기능 무수정, 확인만."
- 실행: dev-foot, READ-ONLY 포렌식 (UPDATE·DDL·seed·RPC mutation 0)
- 인증컨텍스트: **Supabase Management API / postgres 롤 (RLS 우회 = service-level)** — anon 0-row 오독 아님
- probe ts (UTC): 2026-07-25T12:38:35Z
- probe: /tmp/foot_hira_2026_crosscheck.mjs (SELECT-only)

---

## 확인 항목별 판정

### 1. 산식 대상 테이블/컬럼 (도수 동형 여부) — ✅ 동형
풋 진찰료 = `services.hira_score`(점수) × `clinics.hira_unit_value`(환산지수/점당단가) → `ROUND(hira_score × hira_unit_value)`.
- 코드 근거: `src/lib/copayCalc.ts:272` `base = Math.round(service.hira_score * clinic.hira_unit_value)`, `src/lib/footBilling.ts:316-327` 동일 산식.
- **도수(body)와 grain 동일** (clinics.hira_unit_value × services.hira_score). 풋 고유 grain 아님.

### 2. 환산지수 현재값 + year — ✅ 95.60 / 2026
| slug | name | hira_unit_value | year |
|------|------|-----------------|------|
| jongno-foot | 오블리브의원 서울오리진점 | **95.60** | **2026** |
| songdo-foot | 오블리브 풋센터 송도 | **95.60** | **2026** |

→ 89.4(2024)도 NULL(미설정)도 아님. **2026 현행 심평원 의원급 환산지수 적용됨.**
→ column_default = NULL (2행 모두) = governed 강제(89.4/2024 default DROP) DDL도 prod 반영 확인.

### 3. 2026 요청/적용 이력 3분기 판정 — ✅ **요청·적용 완료**
- 환산지수 갱신: `20260714110000_clinics_hira_unit_value_2026_governed.sql` (T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE) → prod 반영 확인(값 95.6 + default DROP 실재).
  - 종별 확정: 의원급 (김주연 총괄 + 이정환 경영BO), DA CONSULT-REPLY 조건부 GO 근거 병기.
- hira_score 적재: `supabase/ops/T-20260722-foot-HIRA-SCORE-GONGDAN-4SVC-LOAD_apply.sql` → 4행 실측 NULL 아님(적재 확인).
  - source: 보건복지부 고시 제2025-186호 · 2026 적용분.

### 4. 초진/재진 현재 표시액 = 점수×환산지수 → 2024/2026 판정 — ✅ **2026 기준**
| service | hira_score | ×95.60(2026) | (참고)×89.4(2024) | services.price(저장) |
|---------|-----------|--------------|-------------------|----------------------|
| AA154 초진진찰료-의원 | 197.07 | **18,840** | 17,618 | 18,840 |
| AA254 재진진찰료-의원 | 139.85 | **13,370** | 12,503 | 13,370 |
| AA222 재진(물리치료·주사) | 49.09 | 4,693≈4,690 | — | 4,690 |
| D620300HZ KOH 진균검사 | 110.20 | 10,537≈10,540 | — | 10,540 |

→ 현재 표시액이 정확히 **2026 basis(×95.60)** 와 일치. 2024 basis(×89.4) 값과 불일치. **2026 기준 정합.**

### 5. (부수) 풋 진찰료값 락/통제 대상 gap — 기록만 (락 구현 금지)
- 도수(body)는 `services.hira_score` 락ON(6/5 불변) 통제 존재. **풋은 hira_score 대상 락/통제 미확인(gap).**
- 단, 풋은 `clinics.hira_unit_value` governed(default 제거 + NULL→BLOCK) + DA SSOT 연도갱신 거버넌스로 환산지수 축은 통제됨.
- hira_score 측 명시적 락은 별도 판단 필요 — **본 티켓 범위 밖(기록만).**

---

## DoD 결론
- 환산지수 현재값: **95.60 / year 2026** (foot clinics 2곳 전부).
- 2026 요청/적용 3분기: **요청·적용 완료** (unit_value 마이그 + hira_score 4svc load 둘 다 prod 반영).
- 현재 표시액: **2026 기준** (초진 18,840 / 재진 13,370 = ×95.60 정합).
- 센터장 관찰("2026으로 안 보임") **반증(REFUTED)** — DB·산식·표시액 모두 2026 현행 기준. 도수와 동일한 95.6/2026 정합.
- 첨부 스크린샷(F0BKP8Q620M) 미확보 상태에서도 DB read-only로 선행 판정 확정. (스크린샷 = 시각적 오인/구버전 캐시 가능성 확인용 보조. 필요 시 responder 통해 후속.)

## 가드레일 준수
- UPDATE·DDL·마이그·seed·RPC mutation **0** (SELECT-only).
- 인증컨텍스트 명시(postgres/service-level, anon 아님).
- 2026 이미 적용 상태 → 추가 실적용 티켓 불요.
