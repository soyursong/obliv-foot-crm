# T-20260617 배치 apply Step A 감사 (READ-ONLY) — 16종 #3~#18
- prod: rxlomoozakkjesdqjtvd | 2026-07-18T05:32:33.493Z

[1] provenance 4컬럼 존재: true (4/4)
    code_source 분포: {"official":500,"custom":19}

[2] 16 custom row 식별 (LEGACY claim_code + code_source=custom)
    #3 LEGACY-1bb57c2e4782 → 1774b3c3-0ecd-49b6-85f0-8b39dfe67c20 이름일치
    #4 LEGACY-1edb55721d2f → 304d99e7-f4af-4f88-876e-68bcfd0ce5be 이름일치
    #5 LEGACY-1f8b80f62fbb → 6a8f2155-f760-4403-a79a-87c25d7bd4f3 이름일치
    #6 LEGACY-2a0c89797bce → 994d5789-738e-4aae-b42d-445b1f3f5b4f 이름일치
    #7 LEGACY-2e28835bfc5f → a8583048-db80-4a74-85f1-b6c10ce49287 이름일치
    #8 LEGACY-3e7ce9b8f6fb → 1993c25a-a847-407b-8249-d7ca93a89c36 이름일치
    #9 LEGACY-45744395cb7a → 7d175a34-9837-4ad7-ad52-ed251bc5a72c 이름일치
    #10 LEGACY-5d19d9727ef4 → bce07aed-e428-4165-ae3d-e1a64622a686 이름일치
    #11 LEGACY-a7a1a9195c67 → 8f418de1-661b-4e1b-8d90-2861d9c2bf03 이름일치
    #12 LEGACY-a9078a1449c3 → f8fdcb92-046d-4719-bb87-0329911e8ab0 이름일치
    #13 LEGACY-ba5c97dfb0b8 → 2d74ecd7-36f8-4cba-a8b0-092a7162abaf 이름일치
    #14 LEGACY-ce36618a71d0 → 5642ca63-f580-406e-a2ba-602c66e87d02 이름일치
    #15 LEGACY-d17507bd1967 → c4dcfad3-a528-4974-9819-3acb4f0c84d4 이름일치
    #16 LEGACY-e11452cf9200 → be87fd12-6954-4ac4-9093-4a4dde7028f6 이름일치
    #17 LEGACY-e98e0cb79ec6 → d00b8a51-5506-4221-b25c-07370482627d 이름일치
    #18 LEGACY-f76313d45cc9 → 1d0d1ffb-12e1-4071-8d83-e5a14e2f285e 이름일치
    → 식별 16/16

[3] custom 참조 지점 (folder + prescription_sets)
    #3 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #4 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #5 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #6 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #7 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #8 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #9 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #10 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #11 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #12 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #13 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #14 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #15 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #16 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #17 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    #18 folder membership 1건: folder=ed3ae609-a2db-4871-ac41-cbe2ddb653e6
    prescription_sets 참조 총 0건 (0 기대 — FLUNACOEM 선례 0)

[4] 목표 official claim_code(HIRA-{품목}) 충돌 검사 → Case 분기
    BARTOBEN HIRA-202401671 → 충돌 0건 ⇒ Case2
    HANMIUREA HIRA-198501225 → 충돌 0건 ⇒ Case2
    CEFACLEAR HIRA-201908179 → 충돌 0건 ⇒ Case2
    STILLEN HIRA-200500248 → 충돌 0건 ⇒ Case2
    LOXOPOFEN HIRA-201802417 → 충돌 0건 ⇒ Case2
    TERMIZOL HIRA-201905864 → 충돌 0건 ⇒ Case2
    BETABATE HIRA-198300730 → 충돌 0건 ⇒ Case2
    HITRI HIRA-200404710 → 충돌 0건 ⇒ Case2
    ESROBAN HIRA-199902738 → 충돌 0건 ⇒ Case2
    JUBLIA HIRA-201702389 → 충돌 0건 ⇒ Case2
    RIDOMEX HIRA-198600458 → 충돌 0건 ⇒ Case2
    LUMAZOL HIRA-201600380 → 충돌 0건 ⇒ Case2
    DRROBAN HIRA-201905373 → 충돌 0건 ⇒ Case2

[5] dedup 3쌍 폴더 collision 검사 (같은 official 로 수렴하는 custom 들이 같은 folder_id 인가)
    BARTOBEN ← #3,#10 | 폴더: [{"n":3,"folders":["ed3ae609-a2db-4871-ac41-cbe2ddb653e6"]},{"n":10,"folders":["ed3ae609-a2db-4871-ac41-cbe2ddb653e6"]}] | 동일폴더중복=⚠YES(reference-move 시 중복 membership → 1건만 이동·나머지 삭제 필요)
    HANMIUREA ← #4,#9 | 폴더: [{"n":4,"folders":["ed3ae609-a2db-4871-ac41-cbe2ddb653e6"]},{"n":9,"folders":["ed3ae609-a2db-4871-ac41-cbe2ddb653e6"]}] | 동일폴더중복=⚠YES(reference-move 시 중복 membership → 1건만 이동·나머지 삭제 필요)
    JUBLIA ← #14,#16 | 폴더: [{"n":14,"folders":["ed3ae609-a2db-4871-ac41-cbe2ddb653e6"]},{"n":16,"folders":["ed3ae609-a2db-4871-ac41-cbe2ddb653e6"]}] | 동일폴더중복=⚠YES(reference-move 시 중복 membership → 1건만 이동·나머지 삭제 필요)

[6] custom 총계 19건 (기대 19)
    무접촉 custom 3건: 플루나코엠캡슐(플루코나졸)(LEGACY-015b55130567) / 오구멘토(LEGACY-f859925fdba2) / 대웅푸루나졸정150mg(플루코나졸)(LEGACY-12d7730e32e8)

## Step A 게이트 요약
```
{"provenance_cols":true,"custom_identified":"16/16","prescription_sets_refs":0,"officials_distinct":13,"Case2":13,"Case1":0,"total_custom":19,"untouched_custom":3}
```
판정: ✅ 배치 apply 스펙 확정 가능 (dry-run/migration 작성 GO)
