# T-20260713-foot-RESV-NAME-ALIAS-CONTAM — 앵커 케이스 검증 (AC-F4 폐쇄)

- 소스: INFO MSG-20260713-112956-cpxo (planner, 박민지 TM팀장 제공 실사례)
- 실행: 2026-07-13, dev-foot · READ-ONLY (SELECT only, DB 無변경)
- probe: `scripts/T-20260713-foot-RESV-NAME-ALIAS-CONTAM_anchor_probe.mjs`
- PHI: 본명(임○옥)·전화 원문 미저장. 앵커 저위험키(별칭 `ok`·예약일 2026-07-21)로 특정, 전화는 마스킹(****4470)만.

## 앵커 특정 결과
- reservation `7ceffb46-f6e7-4acc-8e8b-f0ba6ad09cde`
- customer `ac65896b-ab76-49df-8992-582e51865abd`
- **phone 교차검증: ****4470 = 티켓 ⟦TEL:…4470⟧ 일치 → 동일 환자(임○옥) 확정.**

## AC-1 재현 (오염 확정) ✅
| 필드 | 값 |
|------|-----|
| customers.name | **`Ok`** (별칭 오염) |
| reservations.customer_name | **`Ok`** (예약일 2026-07-21) |
| reservations.customer_real_name | null |
| source_system | dopamine · visit_route TM |
→ **본명(임○옥) 아닌 별칭 `Ok`로 등록됨 = 오염 재현 CONFIRMED.**

## 타임라인 — 7/13 소급 덮어쓰기 아님 (bulk=NO 재입증) ✅
- customers.created_at = updated_at = **2026-07-08 03:01:06 UTC (=12:01 KST)** — dopamine bg31 실측 `crm_synced_at 7/8 12:01 KST`와 정확히 일치.
- reservations.updated_at = 2026-07-08 06:19 UTC.
- **7/13 갱신 0.** → 이 환자에 관한 한 '오늘 다 별칭으로 변경'은 7/13 소급 write 아님, 7/8 최초 push 시 별칭 mint(steady-state per-push). foot forensic bulk=NO 결론과 합치.

## AC-4 백필 freeze 포함 여부 ✅ (+ 정밀 주의)
- 앵커 flags: `ascii_alias_sig=true`(name `Ok` 순수 ASCII=별칭 시그니처), `updated_after_78=true`.
- → 오염 대상셋 freeze 후보에 **포함됨** = freeze 로직 정확성 앵커 확인.
- **⚠ freeze 정밀 주의**: 이 customer의 `lead_source = NULL`. **도파민 연결 판별을 customers.lead_source로 하면 이 행을 놓침.** 신뢰 가능한 도파민 링크지문 = `reservations.source_system='dopamine'` (+ customer_id 조인). freeze 술어는 lead_source 아닌 reservations.source_system 기준이어야 함.
- check_ins = 0건(미래 예약 7/21, 방문 전) → 이 앵커엔 트리거 캐스케이드 footprint 없음(단일 미래 예약).

## AC-4 복원소스 (foot NEGATIVE 재확정)
- foot 어디에도 본명(임○옥) 없음: customers.name=`Ok`, customer_real_name=null.
- → 이 행 백필은 foot 자가 복원 불가. 본명은 외부(도파민 cue_cards 오염前/현장 슬랙) 조달 필요. 사람 게이트 대상.

## 결론
- AC-1 오염 재현·AC-4 freeze 포함·bulk=NO 타임라인 모두 앵커로 재입증. read-only, DB·코드 무변경.
- freeze 술어 정밀 주의(lead_source NULL → source_system 기준) = AC-4 백필 설계 반영 권고.
