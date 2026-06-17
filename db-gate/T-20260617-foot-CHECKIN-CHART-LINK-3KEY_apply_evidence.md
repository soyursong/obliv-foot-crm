# T-20260617-foot-CHECKIN-CHART-LINK-3KEY — AC-6 김사비 차트복구 운영 적용
# at: 2026-06-17T08:54:07.552Z

## BEFORE
```
{
  "id": "4b091fa7-29c9-48c8-854b-42b53905351b",
  "customer_id": "8ba2bbef-018e-4207-b2ab-196e18322437",
  "customer_name": "김사비",
  "clinic_id": "74967aea-a60b-4da3-a0e7-9c997a930bc8",
  "status": "payment_waiting",
  "linked_name": "문자테스트",
  "linked_chart": "F-1189"
}
```

## UPDATE rows affected = 1
  ✓ ROWS AFFECTED = 1 (actual=1)
## AFTER (in-tx)
```
{
  "id": "4b091fa7-29c9-48c8-854b-42b53905351b",
  "customer_id": "2be865ff-6a9d-4666-892c-1cfd2d971199",
  "customer_name": "김사비",
  "clinic_id": "74967aea-a60b-4da3-a0e7-9c997a930bc8",
  "status": "payment_waiting",
  "linked_name": "김사비",
  "linked_chart": "F-0087"
}
```
  ✓ linked customer_id = 김사비(2be865ff)
  ✓ linked_name = 김사비 (actual=김사비)
  ✓ linked_chart = F-0087 (actual=F-0087)
  ✓ clinic 보존 (74967aea-a60b-4da3-a0e7-9c997a930bc8 → 74967aea-a60b-4da3-a0e7-9c997a930bc8)

✓✓ 검증 통과 → COMMIT 완료. 김사비 차트(F-0087) 정상 연결.
