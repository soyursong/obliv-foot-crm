# RXSET-CUSTOM-DRUG-HIRA-MAP — no-op 재대조 결과 (READ-ONLY)

- 실행: 2026-07-19 07:58 KST · dev-foot · prod(rxlomoozakkjesdqjtvd) · **SELECT-only, DML 0건**
- 스크립트: `scripts/T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_noop_recheck.mjs`
- 목적: frontmatter UNBLOCK 지시(a) — 총괄 "대조해서 서비스관리 등록 한거임" 회신 후 중복적용 방지 대조.

## 핵심 결론
1. **no-op 아님.** 배치 16종(오구멘토·대웅·플루나코엠 스핀오프 제외) **전부 여전히 code_source='custom' + LEGACY-\* claim_code, hira_verified_at=NULL, hira_mapped_to_code_id=NULL** = 미반영.
2. **중복위험 없음.** 16종 각각 목표 HIRA-{품목기준코드} official row **0건** — 총괄이 서비스관리에서 official 승격한 흔적 없음.
3. **스핀오프 정합 확인**: 대웅푸루나졸(LEGACY-12d7730e32e8) = **LEGACY 부재**(DAEWOONG-DELETE 실행됨). 플루나코엠(2026-07-17)·오구멘토(2026-07-18) = verified+mapped 세팅(각 스핀오프 apply 완료).
4. **code_source 분포**: official **501** / custom **18** (직전 대조 official 499 / custom 19 대비 official +2=FLUNACOEM/OGMENTO reference row, custom −1=대웅 삭제 → 전부 정합).

## ⚠ 총괄 회신 vs prod 상태 불일치
- 총괄 회신 "대조해서 서비스관리 등록 한거임" → **prod에는 16종 official 승격/매칭 흔적 0**. 총괄이 다른 방식(신규 custom 항목 추가 등)으로 등록했거나 인지 착오 가능. apply 전 확인 필요(중복/오청구 방지).

## apply 선행 gap
- v3 매핑표는 **이름 완전일치(§9.1)만** 확정. **§6 약제급여목록표 대조(EDI 청구코드 + 급여/비급여) 미완** = apply의 실 claim_code/insurance_status 미확정 → apply 前 필요.
- apply 메커니즘 = §8 reference-canonical(official reference row 생성 + custom row provenance stamp, in-place claim_code 교체 금지) — FLUNACOEM/OGMENTO 선례 동형.

## 대상별 상태 (전문)
```
═══════════════════════════════════════════════════════════
T-20260617 RXSET-CUSTOM-DRUG-HIRA-MAP — no-op 재대조 (READ-ONLY)
실행: 2026-07-18T22:58:24.216Z | target: prod https://rxlomoozakkjesdqjtvd.supabase.co
═══════════════════════════════════════════════════════════

[0] provenance 4컬럼: hira_verified_at=true | hira_match_basis=true | hira_mapped_to_code_id=true | hira_verified_by=true 

[1] code_source 분포: {"official":501,"custom":18} (total 519)

[2] 대상별 현재 prod 상태 (custom row + 매칭 official 후보)

  플루나코엠캡슐(플루코나졸)  [스핀오프:FLUNACOEM(NONE)]
     custom_row: src=custom claim=LEGACY-015b55130567 verified=2026-07-17T20:55:40.507987+00:00 mapped=109c78b8-dfaf-4074-ba03-2cccffdc83ad
     official: (NONE 대상, 매칭 없음)

  대웅푸루나졸정150mg  [스핀오프:DAEWOONG-DELETE]
     custom_row: ⚠ NOT FOUND (LEGACY 부재 — 삭제/교체됨?)
     official(HIRA-200600116): 0건 

  바르토벤 외용액 4ml
     custom_row: src=custom claim=LEGACY-1bb57c2e4782 verified=NULL mapped=NULL
     official(HIRA-202401671): 0건 

  한미유리아크림 50g
     custom_row: src=custom claim=LEGACY-1edb55721d2f verified=NULL mapped=NULL
     official(HIRA-198501225): 0건 

  세파클리어
     custom_row: src=custom claim=LEGACY-1f8b80f62fbb verified=NULL mapped=NULL
     official(HIRA-201908179): 0건 

  스티렌
     custom_row: src=custom claim=LEGACY-2a0c89797bce verified=NULL mapped=NULL
     official(HIRA-200500248): 0건 

  록소포펜
     custom_row: src=custom claim=LEGACY-2e28835bfc5f verified=NULL mapped=NULL
     official(HIRA-201802417): 0건 

  터미졸크림 15g
     custom_row: src=custom claim=LEGACY-3e7ce9b8f6fb verified=NULL mapped=NULL
     official(HIRA-201905864): 0건 

  한미유리아크림 20g
     custom_row: src=custom claim=LEGACY-45744395cb7a verified=NULL mapped=NULL
     official(HIRA-198501225): 0건 

  바르토벤 외용액 8ml
     custom_row: src=custom claim=LEGACY-5d19d9727ef4 verified=NULL mapped=NULL
     official(HIRA-202401671): 0건 

  베타베이트연고 15g
     custom_row: src=custom claim=LEGACY-a7a1a9195c67 verified=NULL mapped=NULL
     official(HIRA-198300730): 0건 

  하이트리크림 20g
     custom_row: src=custom claim=LEGACY-a9078a1449c3 verified=NULL mapped=NULL
     official(HIRA-200404710): 0건 

  에스로반연고 10g
     custom_row: src=custom claim=LEGACY-ba5c97dfb0b8 verified=NULL mapped=NULL
     official(HIRA-199902738): 0건 

  주블리아외용액 4ml
     custom_row: src=custom claim=LEGACY-ce36618a71d0 verified=NULL mapped=NULL
     official(HIRA-201702389): 0건 

  삼아리도멕스크림
     custom_row: src=custom claim=LEGACY-d17507bd1967 verified=NULL mapped=NULL
     official(HIRA-198600458): 0건 

  주블리아외용액 8ml
     custom_row: src=custom claim=LEGACY-e11452cf9200 verified=NULL mapped=NULL
     official(HIRA-201702389): 0건 

  루마졸크림
     custom_row: src=custom claim=LEGACY-e98e0cb79ec6 verified=NULL mapped=NULL
     official(HIRA-201600380): 0건 

  닥터로반
     custom_row: src=custom claim=LEGACY-f76313d45cc9 verified=NULL mapped=NULL
     official(HIRA-201905373): 0건 

  오구멘토  [스핀오프:OGMENTO]
     custom_row: src=custom claim=LEGACY-f859925fdba2 verified=2026-07-18T09:54:23.856861+00:00 mapped=ed064049-7dc9-4aa0-bce2-7eb5afd1863e
     official(HIRA-201907725): 0건 

═══════════════════════════════════════════════════════════
[3] 배치 16종(스핀오프 3종 제외) no-op 판정
═══════════════════════════════════════════════════════════
  · 여전히 custom+LEGACY (apply 후보) : 16종
      - 바르토벤 외용액 4ml
      - 한미유리아크림 50g
      - 세파클리어
      - 스티렌
      - 록소포펜
      - 터미졸크림 15g
      - 한미유리아크림 20g
      - 바르토벤 외용액 8ml
      - 베타베이트연고 15g
      - 하이트리크림 20g
      - 에스로반연고 10g
      - 주블리아외용액 4ml
      - 삼아리도멕스크림
      - 주블리아외용액 8ml
      - 루마졸크림
      - 닥터로반
  · 매칭 official 이미 존재 (중복위험) : 0종
  · 승격됨/LEGACY부재 (no-op)          : 0종

  ▶ VERDICT: APPLY 후보 존재 (16종) → 매핑표 갱신 + supervisor DML 게이트 진행
═══════════════════════════════════════════════════════════
```
