# MSDS-APP

## 위험물 위치도

화학물질 → **위험물 위치도** (모바일은 더보기)에서 현장 전경 사진을 올리고,
사진을 클릭하거나 터치해 스티커를 등록합니다. 락카 보관함(보라), 위험물
저장소(빨강), 유류 저장소(갈색), 동(파랑), 게이트(초록)를 아이콘과 색상으로
구분합니다. 동·게이트는 `101동`, `정문`처럼 입력한 이름이 사진에 표시됩니다.
저장소는 물질명과 단위 포함 수량을 행별로 입력하며 최대 50개까지 추가/삭제할
수 있습니다. 관리책임자 입력 대신 기존 현장 협력사 목록을 선택합니다.
저장소 비밀번호는 일반 텍스트로 입력하고 현장 구성원에게 원문으로 표시합니다.

스티커를 누르면 정보를 수정하고 마우스 또는 터치로 드래그하면 놓은 위치를
저장합니다. 이동 실패/취소 시 이전 위치로 돌아갑니다. 목록의 **위치 이동**으로
새 지점을 클릭하는 방식도 지원합니다. **사진 변경 (스티커 유지)**은 같은
위치도에서 사진만 교체하므로 모든 스티커 ID·비율 좌표·입력 정보를 유지합니다.
구도가 달라졌다면 드래그로 조정합니다. 별도 위치도를 추가할 때는 상단
**전경 사진 업로드**, 사진과 스티커 전체를 삭제할 때는 **위치도 삭제**를 씁니다.

JPG/PNG/WebP, 최대 20 MB. 사진은 비공개 `hazard-map-photos` 버킷에 저장하고
한 시간짜리 서명 URL로 표시합니다. 만료 후에는 새로고침으로 다시 표시합니다.
위치는 원본 사진 기준 0–1 비율로 저장해 화면 크기가 바뀌어도 유지합니다.
`hazard_maps`, `hazard_markers`와 파일은 해당 현장 구성원만 조회/등록/수정/삭제할
수 있습니다. 사진/현장 연결은 복합 외래 키로 검증하고, 현장·작성자 재지정과
익명 접근을 금지합니다. 협력사도 복합 외래 키로 같은 현장 소속을 검증합니다.
물질 배열의 형식/개수/길이와 스티커 종류는 DB에서 검증합니다. 업로드/교체 후
DB 저장 실패 시 새 파일을 정리하며, 사진 교체 성공 후 이전 파일을 정리합니다.
사진 교체는 이전 파일 경로 조건으로 동시 변경을 감지해 덮어쓰기를 방지합니다.

`supabase/migrations/20261023010754_hazard_maps.sql` 및
`supabase/migrations/20261023023814_hazard_map_sticker_details.sql`을 운영 Supabase에
2026-10-23 (Asia/Seoul) 적용했습니다. 웹 화면 반영에는 Vite 빌드 배포가 필요합니다.

검증: `npm run build`, `npm test`, 개발 서버 실행 후
`python tests/hazard-map.browser.py`. 브라우저 검증은 합성 응답으로 업로드,
물질별 수량·협력사·비밀번호, 다섯 종류 스티커, 재접속, 수정/이스케이프,
마우스/터치 드래그·취소·저장 실패 복원, 비율이 다른 사진으로 교체 후 모든
스티커 정보 유지, 여러 사진, 360/390/768/1440px와 파일 정리/재시도를 검사합니다.
`tests/hazard-map.sql`은 rollback 트랜잭션에서 실제 DB의 현장별 접근 제어,
쓰기/삭제 권한, 현장/협력사 외래 키, 좌표/이름/종류/물질 배열 제약,
사진 교체 시 스티커 유지, 연쇄 삭제와 익명 차단을 검증합니다.
고객 현장이나 문서를 변경하지 않습니다.

## Site contractor directory

The Contractors screen provides a separate, revocable 30-day directory link at
`/contractors.html?dtoken=...`. Site owners/admins issue it. Recipients see the
site's complete contractor list, computed license/MSDS submission status,
manager name and tappable phone number, can edit contact details, register a new
company, and open that company's existing management portal. Mobile uses cards;
desktop uses a table with search and missing-document filters.

The directory schema and contact APIs were applied to production on 2026-10-22
(Asia/Seoul).

Contact fields `contractors.manager_name` and `manager_phone` are shared by the
manager application and directory, with no duplicate contractor database.
Submission flags are computed from `business_licenses` and `msds_records` using
the manager application's received-file definition; no independent flags can
become stale. Contact edits cannot rename a contractor, preserving existing
name-based MSDS associations. Registration rejects normalized duplicate names.

`supabase/contractor_directory.sql` adds these fields and the protected
`contractor_directory_links` table. Tokens are deliberately separate from legacy
`public_upload_links`, whose anonymous SELECT policies must not expose directory
contact-edit capabilities. Only owners/admins can read, issue or revoke tokens.
Anonymous legacy table reads cannot select the new contact columns; public
registration uses a validated token RPC. Signed-in contact edits use a workspace
membership check and update only contact fields. Token-scoped RPCs allow recipients to read/edit only that site's contacts and
register into the existing contractors table. Invalid, revoked, expired or
cross-site requests are rejected. Individual contractor links cannot enumerate
contacts or access the directory. Existing upload/public links retain their
scope and expiration. Directory links operate independently of public-upload
link revocation. Both management screens can refresh shared data; returning to
contractor management refreshes contacts and submission state.

Validation: `tests/contractor-directory.sql` runs within a rollback-only database
transaction; `tests/contractor-directory.browser.py` uses synthetic API responses
and checks filters, edits, registration/duplicates, navigation, expired links
and 360/390/768px layouts without customer-document writes.

## Contractor management portal

`/upload.html?token=...` opens `{현장명} {협력사명} 관리페이지`.
It includes existing MSDS originals/search, uploads, warning-label printing
(A4/A5/A6/mini, copies, QR), and first-time business-license registration.
Public `?ptoken=...` links retain contractor selection and their document-type
permissions. The portal uses a separate, nonpersistent anonymous Supabase client
so a manager's signed-in session cannot change the contractor's access.

Deployment requires **both** the Vite build and
`supabase/contractor_management_portal.sql`. The SQL was approved by the user,
applied to production on 2026-10-22 (Asia/Seoul), and verified for anonymous
execution and rejection of invalid and mismatched contractor tokens.

The two RPCs intentionally use `SECURITY DEFINER` with an empty `search_path`;
`PUBLIC` and `authenticated` execution are revoked and only `anon` is granted.
`get_contractor_portal` validates the token and expiration on every call, derives
site/company from the individual token, rejects mismatched contractor IDs, and
returns only that site's company documents. Public links additionally enforce
`allow_msds`/`allow_license`. `register_contractor_license` reuses those checks,
validates the file path/name and inserts a first-time license without granting
anonymous table UPDATE access. General table/storage policies are unchanged.
These functions deliberately authorize by a bearer capability rather than
`auth.uid()`, since recipients do not sign in. New individual/public link tokens
use 192 cryptographic random bits; existing valid links continue working.

Validation: `npm run build`, `npm test`, and
`BASE_URL=http://localhost:3003 python tests/contractor-portal.browser.py` after
starting `npm run preview -- --host 0.0.0.0 --port 3003`. The browser test uses
synthetic API/storage responses, covers both link types, original-file links,
search, license/MSDS uploads, four print sizes/QR, invalid/missing tokens and
360/390/768px layouts. It does not write customer documents. The existing
`warning-print.browser.py` checks printed QR pixels and label bounds for the
shared warning renderer. Production SQL was validated in a rollback-only
transaction against existing tokens, including invalid and mismatched tokens.

## Team invitations

Workspace owners and admins create single-use team links from Settings. Links
expire after seven days, can be revoked, and require a signed-in recipient to
explicitly confirm joining. Existing memberships keep their role. An existing
member opening a link does not consume it or gain additional privileges.

`20261015055940_workspace_invite_links.sql` provides the hashed-token table and
authenticated RPCs. Direct client access to the token table is denied. The
permission-checked RPCs intentionally use `SECURITY DEFINER` to add a membership
atomically after validating the invitation; raw tokens are returned only when
created. Legacy email-based signup invitation triggers are disabled. Pending
legacy email invites do not automatically add newly registered users.

Password-reset email requests and invitation email requests are paused in the
application UI. Supabase Auth settings are shared with other applications and
are not globally disabled by this change. Existing recovery links can still
complete a password update.

The headquarters management page is currently a proposal only. It has not been
implemented, and no cross-workspace access is granted by the invitation feature.

## Detailed site weather

The Home “날씨 자세히” button and desktop/mobile “날씨” tab open a 7/16/30-day
calendar with hourly temperature, humidity, rain probability/amount, wind speed
(m/s) and direction. Heat posters remain available below the detailed forecast.

Deploy `supabase/functions/site-weather` including `detailed.ts` and `lib/forecast.js`.
Set the **server-side** Supabase function secret `KMA_SERVICE_KEY` to a public-data
portal service key authorized for 기상청 단기예보 조회서비스 (`getVilageFcst`).
Never put this key in a `VITE_` variable. The function converts the saved site
coordinates to the KMA grid and selects the latest run with a publication delay.
KMA supplies the available short-term hourly metrics; apparent temperature is
explicitly sourced from Open-Meteo. Open-Meteo supplies up to 16 days and serves
as fallback when the KMA key is missing or KMA is unavailable. Provider warnings
and sources are visible. Missing values are not converted to zero.

The 30-day calendar does **not** invent a daily month forecast: dates beyond the
available forecast display “예보 미제공”. KMA's 1-month outlook is a weekly trend,
not daily humidity/wind/rain probability. A Weather Nuri link is provided; the
monthly outlook itself is not fetched. Day aggregates use available hourly slots,
so a partial first/last day can have incomplete extremes. The existing Home
weekly card and heat posters continue using the original Open-Meteo endpoint.

Validation: `npm test` includes KMA grid/run selection, missing-value handling,
provider priority and fallback tests using mocked provider responses. Live KMA
verification requires the service key and outbound access to `apis.data.go.kr`;
Open-Meteo requires `api.open-meteo.com`.

### AWS / ASOS observations

`KMA_APIHUB_KEY` is a separate **KMA API Hub** authKey, not the public-data portal
serviceKey. The `observations` action uses API Hub's AWS minute and ASOS hourly
endpoints. It resolves station coordinates from `stn_inf.php` (`inf=AWS` / `SFC`),
selects a nearby station within 100 km, and includes the station ID, distance,
observation timestamp, and stale-data status. Up to three nearby stations are
tried if observations are missing or stale. Observation failures do not block
forecasts. Station catalogs are cached for six hours and station readings for
one minute within each Edge runtime instance.

API Hub permissions must include all four services: **AWS minute observations,
ASOS hourly observations, ground station information (SFC), and AWS station
information**. Station-information services require their own utilization
approval. The API reports a specific approval warning when readings can be
queried but station-location lookup is denied. Once approved, refreshing the
weather tab retries the request; no key or code change is needed.

AWS and ASOS have distinct column layouts, wind-direction units and missing-value
codes. Negative temperatures are retained; missing humidity, rain and wind values
remain null. AWS 60-minute rain is not substituted with ASOS rain of an unknown
accumulation period. Readings appear separately from forecast rain probability.

### Seasonal health posters and weather views

Weather opens a compact five-tab workspace: health poster, hourly chart, detailed
forecast (7 days by default), observations, and archive. Tabs request data when
selected; poster and hourly chart share their forecast. Keyboard arrows/Home/End
navigate the tab list. Hidden panels do not contribute to page height.

The A4 portrait (1260×1782 SVG / 2520×3564 PNG) health poster shows every forecast hour from 06–19 with
actual temperature and apparent-temperature lines, a separately scaled wind-speed
bar chart (m/s), and an exact hourly table. Mobile uses a readable health summary
and an original-size poster link; the chart and table scroll horizontally.

Automatic topics use summer (June–September), winter (November–February), and
transition months; forecast apparent temperatures ≥31°C or ≤0°C select heat/cold
preparation respectively. These select editorial guidance, not official alerts or
work-stoppage decisions. A topic selector can override automatic selection.
Each topic has seven daily guidance sets selected deterministically by the Korean
calendar date. The same date keeps the same advice; the next date rotates it.
An open weather page checks for Korean-date rollover every minute and when the
page becomes visible, refreshing the forecast and daily guidance. This creates
on-demand posters, not a scheduled background archive or message delivery.


The A4 poster uses a white editorial layout, large temperature figures, one
seasonal accent, and separate morning/afternoon tables. The A4 print action opens
a 210×297 mm sheet with zero CSS page margins; PNG export explicitly scales the
SVG to 2520×3564 pixels so the poster is not cropped by the canvas. Printer
hardware margins may still require the printer's fit-to-page option.

### Site threshold alerts

The health poster, hourly chart/table, and mobile health summary flag forecast
wind speed ≥10 m/s, apparent temperature ≥31/33/35°C (주의/경계/위험), and actual
temperature ≤−12/−15°C (주의/경고). Thresholds are inclusive and evaluated against
unrounded values. Missing metrics never trigger an alert. Each hourly value has
its own severity; the summary shows the highest reached severity for each hazard
with its matching hours. Seasonal overrides do not suppress weather alerts.
These are user-requested site thresholds, not official KMA advisories.

Daily guidance prioritizes all detected hazards, then temperature swing (≥10°C),
hot/humid conditions, and seasonal advice. Risk-specific wording also rotates by
Korean date, including when the same weather conditions persist across weeks.

### 현장 날씨 포스터 언어와 위치

날씨 → 포스터에서 한국어, 중국어(간체), 미얀마어, 러시아어를 선택합니다.
현장명과 저장 주소는 등록한 원문을 유지하고, 제목 날짜·경고·그래프·수치표·건강 안내는 선택한 언어로 표시합니다.
제목은 `현장명 / 월 일 오늘의 날씨`이며 건강 안내는 날짜, 계절, 예보와 현장 경고 기준에 따라 달라집니다.
86개 안내 문구는 정적 번역 카탈로그로 관리하며 외부 번역 API를 호출하지 않습니다.
외국어 포스터는 OFL 글꼴 부분집합을 SVG 안에 포함합니다. 라이선스는 `public/fonts/LICENSE-*`에 있습니다.
A4 세로 인쇄 및 2520×3564 PNG로 저장할 수 있습니다.

현장 설정에서 주소와 좌표를 저장하면 해당 좌표로 `site-weather` 예보를 요청합니다.
현장명·주소·좌표·한국 날짜가 달라지면 포스터 캐시를 갱신하며 이전 위치 요청이 늦게 끝나도 새 포스터에 덮어쓰지 않습니다.
2026-10-22 검증: 실제 지오코딩과 예보 API로 서울 시청(37.56637,126.97792) 및 제주 시청(33.50021,126.53222)을 조회했습니다.
06–19시 기온은 서울 4.4–14.3°C, 제주 13.3–15.9°C로 달랐고 최대 풍속은 각각 1.28,4.8m/s였습니다.
브라우저에서는 이 실제 응답을 재생해 설정 저장 → 위치별 요청 → 포스터 변경, 현장명만 변경할 때 캐시 갱신,
네 언어 전환, PNG 크기를 확인했습니다. 실제 운영 현장 설정은 변경하지 않았습니다.

## 현장별 바인더 표지

현장 지원 → 바인더 표지(모바일은 더보기)에서 사용자가 제공한
`현장문서_표준목록표_정제.xlsx`의 40개 문서를 기본값으로 사용합니다.
대분류 기호·명칭, 중분류 기호·명칭, 소분류 번호·제목과 상세 정보 11개 열을 보존합니다.
현장별 추가·수정·삭제, 번호 변경, Excel 가져오기·내보내기와 누락 기본 항목 추가를 지원합니다.
기본 항목의 안정된 ID로 현장에서 번호를 변경해도 기본 목록 추가 시 중복 생성하지 않습니다.
가져오기는 교체 전 확인하며 내보내기는 폭·표준 문서명·번호 목록·하단 세 칸도 보존합니다.
새 기본 목록은 이미 저장된 현장 수정본을 자동으로 덮어쓰지 않습니다.

폭은 기본 미선택이며 목록과 문서 수정 화면에서 7cm 또는 9cm를 선택해 현장별로 저장합니다.
화면에서 mm 숫자를 직접 입력하지 않습니다. 기존에 저장된 다른 폭은 재선택을 안내하며 임의로 바꾸지 않습니다.
엑셀은 폭(cm)으로 내보내고 기존 폭(mm) 열이 있는 파일도 가져올 수 있습니다. 내부 인쇄 좌표는 mm를 사용합니다.
현장명은 현재 현장 정보를 사용하며 출력용으로 변경할 수 있습니다.
현장 수정본만 `binder_catalogs`에 저장하고 같은 현장 소유자·멤버가 공유합니다.
다른 현장은 RLS로 분리하고 revision 비교로 동시 저장 충돌을 감지합니다.
`supabase/binder_catalog.sql`은 2026-10-23 KST에 적용했습니다.
개발 미리보기 `?preview=binders`는 sessionStorage를 사용합니다.

출력은 A4 세로 210×297mm, 여백 10mm, 라벨 간격 4mm입니다.
라벨 높이는 기본 260mm(180~277mm 조절)이며 190mm 안에 들어가는 라벨을 순서대로 배치합니다.
정상 열람되는 새 `GS건설 바인더표지 양식.xlsx`에서 7cm·9cm 원본을 각각 추출합니다.
`src/data/binder-templates.js`는 병합 셀, 행 높이, 열 폭, 명시된 double/thin/medium 선과
로고 이미지·앵커를 담습니다. 병합 셀의 외곽을 기준으로 SVG 테두리를 그리며 Excel 화면의
격자선은 출력하지 않습니다. 7cm 분류 기호 칸은 20%, 9cm는 원본처럼 약 16.85%입니다.
소분류 번호 칸 원본 높이도 7cm는 51pt, 9cm는 30.6pt로 별도 반영합니다.
7cm·9cm를 고르면 해당 원본을 자동 적용합니다.
폭과 높이는 앱에서 지정한 mm 값을 사용하고 원본 내부 좌표를 해당 크기에 정규화합니다.
원본 Excel의 30%·35% 인쇄 축소율은 사용하지 않습니다.
현장명, 대·중분류 기호/명칭, 소분류 번호, 세로 제목, 번호 라벨, 하단 네 칸,
파일 내장 GS건설 로고 순서로 출력하며 하단 마지막 '현장안전'은 고정합니다.
제목은 표준 문서명을 생략·축약·치환하지 않고 한 열로 세로 배치합니다.
띄어쓰기의 세로 여백을 0.35em으로 줄이고, 영문은 원문 그대로 묶어 옆으로 회전해 세로 배치합니다.
첨부한 HY헤드라인M의 실제 ASCII advance 폭을 사용해 제목 크기를 계산합니다.
한글 행 간격은 1em으로 글자가 겹치지 않게 유지합니다. 칸보다 긴 제목은 전체 문구가 들어가도록 축소합니다.
라벨 전체를 감싸는 0.25mm 실선 재단 테두리를 항상 출력하며, 배경 인쇄를 꺼도 표시됩니다.
사용자가 제공한 HY헤드라인M을 public/fonts/hy-headline-m.ttf에서 불러오고 인쇄 문서에도 포함합니다.
원본의 cmap에 범위를 벗어난 glyph 65535 참조가 있어 Chromium OTS가 거절하므로
scripts/prepare-binder-font.py가 문자 매핑 테이블을 재구성합니다. 글리프 윤곽과 이름은 유지합니다.
공급 파일을 바꿀 때 이 스크립트를 사용하며 ASCII 폭 데이터도 확인해야 합니다.
글꼴을 불러오지 못하면 로컬 설치 글꼴을 확인하고, 둘 다 없으면 인쇄를 차단합니다.
글꼴은 자동으로 적용하고 별도 안내 박스·파일 선택 버튼을 표시하지 않습니다.
GS건설 로고는 하단 네 칸 아래 영역의 가로·세로 중앙에 배치하며 원래 비율을 유지합니다.

폭 미지정 문서는 출력하지 않습니다. 실제 치수 유지를 위해 배율 100%,
머리글/바닥글 끄기를 사용하며 노란 배경은 print-color-adjust:exact로 지정했습니다.
프린터 드라이버의 강제 축소나 흑백 설정은 앱에서 제어할 수 없습니다.

검증: npm test, npm run build, Chromium에서 40개 로딩·폭 지정·수정·새로고침 유지·
복수 매수·A4 PDF·모바일 390px 레이아웃, 정제 Excel 가져오기 및 내보내기 왕복을 확인했습니다.
한 열 제목·자동 축소, 외곽 재단선, 노란 배경, 이중선, 하단 네 칸, GS 로고 로딩을 확인했습니다.
서버 RLS 외부 사용자 조회 차단은 기존 rollback 검사로 확인했지만,
소유자 읽기·쓰기와 번호 14 및 완료 표시 저장을 실제 DB의 rollback 트랜잭션에서 확인했습니다.

### 전체 검색 · 최근 번호 기억 · 화면 개선

기본 40개 문서의 A~H 8개 분류를 모두 표시하며, 추가한 품질 등 별도 대·중분류도 자동으로 필터에 나타납니다.
문서명·번호·분류·상세내용·비고를 검색합니다. 기본 검색어와 분류는 '전체'입니다.
검색·분류·문서별 폭·인쇄번호를 한 목록에 배치합니다. 상단과 목록의 문서 추가 버튼, 각 행의 수정 버튼에서
문서 제목·분류·폭을 추가/변경하고 현장에 저장합니다. 저장한 제목은 목록·검색·인쇄물에 그대로 반영됩니다.
문서 추가 대화상자는 현재 보고 있는 분류를 미리 채우고 저장 후 해당 분류에 새 문서를 표시합니다.
목록은 자체 스크롤, 인쇄 도구와 미리보기는 고정되며 모바일은 한 열로 배치합니다.

`supabase/binder_print_history.sql`로 print_history와 last_print_numbers를 추가했습니다.
catalog·번호·요청 이력은 같은 revision 비교로 원자적으로 저장하므로 다른 담당자의 수정과 충돌하면
인쇄를 시작하지 않고 새 정보를 불러오도록 안내합니다. 기록이 저장된 뒤에만 인쇄창을 엽니다.
요청은 actual printed가 아니므로 requested/confirmed/cancelled로 구분하고 사용자가 출력 완료/취소를 표시합니다.
최근 100건은 목록으로 보관하며, 문서별 마지막 번호는 별도 맵에 남겨 100건을 넘어도 기억합니다.
변경 가능한 분류 코드와 별도로 문서 ID를 유지해 문서번호를 변경해도 기록을 연결합니다.
마지막 숫자 라벨의 다음 번호를 제안하며 0014 → 0015처럼 선행 0을 보존합니다.
현장 RLS는 기존 binder_catalogs 정책을 적용하고, 번호는 기기·팀원 간 같은 현장에서 공유합니다.

번호 묶음 설정에서 14-18, 14,16,20, 14-16,20을 입력하거나 문서별 권수와 최근 다음 번호로 채웁니다.
서로 다른 번호 개수와 번호당 복사본 수를 분리합니다. 중복 번호는 오류로 알리고, 한 문서 200개·한 번 500개 라벨로 제한합니다.
모든 실제 번호를 요청 기록에 저장하고 가장 큰 숫자의 다음 번호를 제안합니다. 0014 같은 선행 0도 유지합니다.
번호 목록을 현장 엑셀에 포함하며 과거 단일 번호 이력도 그대로 읽습니다.

검증: npm test, npm run build, tests/binder-print.browser.py(실제 첨부 HY, 전체 원문 유지,
영문 세로 배치, 연속·개별 번호, 중복 방지, 번호별 복사 수, 새로고침 후 기록·다음 번호·완료 상태, 모바일).
공유 PDF는 실제 HY헤드라인M을 포함하며 A4 치수와 배경을 꺼도 남는 외곽 재단선을 확인합니다.

## PMX 현장 연동 및 담당자 승인

현장 생성 입력창에서 현장명·코드·분류로 검색하고 결과를 선택합니다. 없는 현장은 주택·플랜트·인프라·기타로 직접 추가할 수 있습니다. 현장코드는 선택 사항이며 PMX 코드와 앱 내부 코드는 별개입니다. 앞자리 0은 유지합니다.

DB 변경은 `supabase/migrations/20261024001502_pmx_sync_and_team_approval.sql`입니다. 기존 초대 링크 함수가 먼저 적용되어 있어야 합니다. 운영 DB에 자동 적용되지 않습니다. 앱 배포와 함께 적용해야 저장·승인·이전 RPC를 사용할 수 있습니다.

- 담당자: 현장 소유자 및 admin. 가입 승인·거절과 팀원 관리를 할 수 있습니다. 소유자인 담당자가 권한을 이전하면 기존 담당자는 일반 직원(member)으로 내려가고 남은 초대 링크는 취소됩니다.
- 초대 수락은 가입 신청을 생성합니다. 담당자 승인 전에는 현장에 참여할 수 없습니다.
- 화면은 기존 `gs-design.css`의 흰색·회색 카드와 짙은 버튼 등 디자인 토큰을 사용합니다. 대시보드에서 현장코드·분류는 숨깁니다. 화면 변경 시 실제 스크린샷과 사용자가 열 수 있는 링크를 함께 제공합니다.

### 설치 없는 PMX 즐겨찾기 가져오기

1. 담당자가 ‘즐겨찾기 설정’에서 ‘보건관리로 보내기’ 링크를 즐겨찾기 모음에 등록합니다. 처음 한 번만 등록합니다.
2. ‘PMX 열고 동기화’로 PMX를 열고 로그인한 뒤 등록한 즐겨찾기를 누릅니다.
3. 즐겨찾기는 PMX 안에서 알려진 현장 목록 GET API를 한 번 호출합니다. Cookie·비밀번호·직원번호를 읽거나 전달하지 않습니다. 현재 확인된 주택(N0) API만 사용합니다.
4. 허용된 여섯 필드의 JSON 스냅샷만 URL fragment에 담아 고정 수신 페이지 `/pmx-import.html`로 이동합니다. fragment는 HTTP 요청으로 서버에 전달되지 않으며 수신 즉시 주소에서 제거합니다.
5. 수신 페이지에서 스냅샷 구조·필드·값·크기·조회 시각을 검사한 뒤 메인 앱으로 이동합니다. 로그인한 사용자가 대상 계정·현장·일정·공정률을 확인하고 명시적으로 반영해야 저장됩니다.
6. 담당자 권한과 연결된 현장코드가 일치하는 현재 현장에만 공정률을 저장합니다. 다른 현장으로 전환했거나 계정이 바뀌면 재확인이 필요합니다. 서버에서도 권한을 확인합니다. 임포트 전송 자체로 저장하지 않습니다.

PMX와 앱 사이에 opener·WindowProxy·postMessage·상주 수신기·임의 요청 프록시를 만들지 않습니다. 앱에서 여는 PMX는 noopener/noreferrer이며 PMX 쪽 즐겨찾기도 opener 연결을 끊고 이동합니다. URL 데이터가 크거나 이동할 수 없으면 JSON 파일을 내려받아 앱의 ‘파일 가져오기’에서 확인 후 반영합니다. PMX의 CSP나 회사 브라우저가 즐겨찾기 실행을 제한하면 이 경로도 동작하지 않을 수 있으며, 보안 설정을 해제하도록 안내하지 않습니다.

이 경로는 사용자가 PMX에서 보내고 내용을 확인할 때 갱신하는 수동 방식입니다. 자정 자동 갱신은 수행하지 않습니다. 실제 PMX 로그인 환경과 CSP/COOP 정책은 이 작업 환경에서 검증할 수 없으므로 운영 확인이 필요합니다. 이전 확장 프로그램을 이미 설치했다면 제거하고 새 즐겨찾기 경로를 사용합니다.

검증: `npm test`, `python tests/pmx.browser.py`, `python tests/pmx-bookmark.browser.py`. 테스트는 모의 PMX/API를 사용하며 운영 데이터에 쓰지 않습니다. 실제 PMX 로그인이 성공했다는 근거로 사용하지 않습니다.
