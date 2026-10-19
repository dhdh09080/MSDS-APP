# MSDS-APP

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
