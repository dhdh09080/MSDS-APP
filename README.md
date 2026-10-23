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
