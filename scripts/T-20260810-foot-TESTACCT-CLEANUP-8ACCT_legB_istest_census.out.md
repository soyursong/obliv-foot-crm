# Leg B is_test census — 2026-08-10T15:55:37.641Z
foot prod rxlomoozakkjesdqjtvd / READ-ONLY

## 1) customers.is_test 컬럼 실재
```json
[]
```
(적용 前 기대: 0행 = 컬럼 부재)

## 2) chart_number → id 해소 + NFC-exact + is_simulation
```json
[
  {
    "id": "e72022d0-7cf5-4f42-b5e3-b5162005b454",
    "chart_number": "F-4427",
    "name": "풋테스트1",
    "is_nfc": true,
    "is_simulation": false,
    "created_at": "2026-06-30 08:11:26.295229+00"
  },
  {
    "id": "351d34c5-2dd9-4583-bfb3-8e27025777a6",
    "chart_number": "F-4574",
    "name": "총괄테스트중",
    "is_nfc": true,
    "is_simulation": false,
    "created_at": "2026-07-10 00:48:38.943179+00"
  },
  {
    "id": "78975d00-9d31-4ac3-848c-0f77c6f0d735",
    "chart_number": "F-4990",
    "name": "서류테스트",
    "is_nfc": true,
    "is_simulation": false,
    "created_at": "2026-07-22 00:52:09.043693+00"
  },
  {
    "id": "80df7a6b-077d-46db-b9db-31591f3977a4",
    "chart_number": "F-5113",
    "name": "서류테스트2",
    "is_nfc": true,
    "is_simulation": false,
    "created_at": "2026-07-24 05:35:29.795229+00"
  }
]
```
유일성 위반(기대 0행): []

## 3) 이름 NFC-exact 대조
- F-4990: db='서류테스트' 기대='서류테스트' 일치=true NFC=true id=78975d00-9d31-4ac3-848c-0f77c6f0d735
- F-4574: db='총괄테스트중' 기대='총괄테스트중' 일치=true NFC=true id=351d34c5-2dd9-4583-bfb3-8e27025777a6
- F-5113: db='서류테스트2' 기대='서류테스트2' 일치=true NFC=true id=80df7a6b-077d-46db-b9db-31591f3977a4
- F-4427: db='풋테스트1' 기대='풋테스트1' 일치=true NFC=true id=e72022d0-7cf5-4f42-b5e3-b5162005b454

## 4) 재무 접점 (payments/service_charges/package_payments)
- payments: [{"cid":"78975d00-9d31-4ac3-848c-0f77c6f0d735","n":2,"net":0},{"cid":"80df7a6b-077d-46db-b9db-31591f3977a4","n":4,"net":0}]
- service_charges: [{"cid":"78975d00-9d31-4ac3-848c-0f77c6f0d735","n":2},{"cid":"80df7a6b-077d-46db-b9db-31591f3977a4","n":2}]
- package_payments: []
- package_credit_ledger: []