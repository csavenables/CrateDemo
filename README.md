# myris-viewer-builder

`myris-viewer-builder` is a non-destructive sibling copy of the original viewer with an additive builder workflow.

## What was added

- Right-side Builder Panel with registry-driven feature controls.
- Persistent builder config via localStorage (`myris.builder.config.v1`).
- Feature registry system (`src/features/featureRegistry.js`) with the first feature:
  - `Lateral restriction` (yaw min/max with `initialHeading` or `worldForward` reference).
- Telemetry abstraction (`src/telemetry/TelemetryClient.js`) with Edge Function ingestion support.
- CTA module with event-first tracking:
  - `View product`
  - `Enquire`
  - Optional `Buy now`
- Debug telemetry HUD additions under `?debug=1`.

## Run locally

1. Open terminal in `myris-viewer-builder`.
2. Run:
   ```powershell
   python .\dev-server.py
   ```
3. Open `http://127.0.0.1:8080`.
4. Configure Miris key/assets in `splat-config.js`.

## Supabase MVP setup

1. Apply schema in `supabase/schema.sql`.
2. Apply dashboard views in `supabase/analytics/views.sql`.
3. Deploy function in `supabase/functions/ingest-event/index.ts` as `ingest-event`.
4. Set telemetry endpoint in Builder Panel (Telemetry -> Edge endpoint) or in `splat-config.js` `TELEMETRY_ENDPOINT`.

## Event coverage

- `viewer_opened`
- `asset_loaded`
- `feature_toggled`
- `setting_changed`
- `button_pressed`
- `view_product_clicked`
- `enquiry_clicked`
- `purchase_link_clicked`
- `viewer_error`
- `session_ended`

## Query examples

Average session duration:
```sql
select avg(duration_ms) as avg_duration_ms
from sessions
where duration_ms is not null;
```

Top buttons:
```sql
select payload->>'button_id' as button_id, count(*) as presses
from events
where name = 'button_pressed'
group by 1
order by presses desc;
```

Simple funnel:
```sql
select
  count(*) filter (where name = 'viewer_opened') as opened,
  count(*) filter (where name = 'view_product_clicked') as viewed_product,
  count(*) filter (where name = 'enquiry_clicked') as enquired,
  count(*) filter (where name = 'purchase_link_clicked') as purchase_clicks
from events;
```
