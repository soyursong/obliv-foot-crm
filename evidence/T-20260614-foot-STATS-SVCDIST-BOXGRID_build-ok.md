# T-20260614-foot-STATS-SVCDIST-BOXGRID — build OK evidence

FIX-REQUEST MSG-20260614-221158-2q66 (qa_fail phase1=build_fail) 대응.
build_fail 재현 불가 — primary/worktree 둘 다 EXIT 0.

## bash scripts/build.sh 120 (primary, exit 0)
```
dist/assets/Sales-pbOtw-T8.js                            46.94 kB │ gzip:  11.85 kB
dist/assets/select-Btyx9Jci.js                           47.19 kB │ gzip:  17.43 kB
dist/assets/CustomerHoverCard-BefW1oW4.js                48.16 kB │ gzip:  15.37 kB
dist/assets/vendor-dnd-CKmvGhkb.js                       49.51 kB │ gzip:  16.39 kB
dist/assets/Packages-Bu2159vW.js                         51.23 kB │ gzip:  11.51 kB
dist/assets/SelfCheckIn-BYkFfLLR.js                      53.67 kB │ gzip:  13.81 kB
dist/assets/NhisLookupPanel-CvG6Gh3s.js                  57.44 kB │ gzip:  17.32 kB
dist/assets/DoctorTools-Y9aer292.js                      58.76 kB │ gzip:  15.45 kB
dist/assets/vendor-icons-sXRESMKL.js                     59.32 kB │ gzip:  11.11 kB
dist/assets/PenChartTab-L5vw771C.js                      61.24 kB │ gzip:  20.97 kB
dist/assets/Closing-C4q172aY.js                          62.60 kB │ gzip:  17.63 kB
dist/assets/CheckInDetailSheet-oRE04Yly.js               73.74 kB │ gzip:  19.33 kB
dist/assets/MedicalChartPanel-62xlJmu7.js                91.66 kB │ gzip:  24.56 kB
dist/assets/Reservations-DPjuHK9G.js                     95.12 kB │ gzip:  26.50 kB
dist/assets/ReservationMemoTimeline-CiIqssNv.js         107.35 kB │ gzip:  22.34 kB
dist/assets/ClinicManagement-lsDFtH8a.js                128.56 kB │ gzip:  32.01 kB
dist/assets/Dashboard-Ceq8TgV7.js                       143.33 kB │ gzip:  39.62 kB
dist/assets/index-BpcaFlfv.js                           174.09 kB │ gzip:  55.46 kB
dist/assets/vendor-react-DLcVYwUy.js                    186.69 kB │ gzip:  61.79 kB
dist/assets/vendor-supabase-D3Pb_Qvf.js                 196.92 kB │ gzip:  51.71 kB
dist/assets/CustomerChartPage-BKc1XJKL.js               272.35 kB │ gzip:  65.95 kB
dist/assets/vendor-charts-f3x8NC2H.js                   397.33 kB │ gzip: 115.82 kB
dist/assets/xlsx-CKN5doRT.js                            424.23 kB │ gzip: 140.56 kB
dist/assets/vendor-pdf-D4iDn8R1.js                      529.45 kB │ gzip: 210.25 kB
✓ built in 4.25s
```

- primary: real 14.5s, EXIT 0
- 신규 worktree(LOCK IDENTICAL, symlink fast-path): real 14.3s, EXIT 0
- typecheck(tsc -b) ~10s + vite build ~4s
- RCA: build.sh 240s floor 워치독이 친 것 = 14s 빌드가 240s 초과 = macstudio 동시 빌드 CPU 경합(transient). 코드 결함 아님.
