create or replace view public.analytics_device_mix_daily as
select
  date_trunc('day', started_at) as day,
  coalesce(device_type, 'unknown') as device_type,
  coalesce(os, 'unknown') as os,
  coalesce(browser, 'unknown') as browser,
  count(*) as sessions
from public.sessions
group by 1,2,3,4;

create or replace view public.analytics_geo_daily as
select
  date_trunc('day', started_at) as day,
  coalesce(country, 'unknown') as country,
  coalesce(region, 'unknown') as region,
  coalesce(city, 'unknown') as city,
  count(*) as sessions
from public.sessions
group by 1,2,3,4;

create or replace view public.analytics_interaction_quality_daily as
select
  date_trunc('day', started_at) as day,
  avg(time_to_first_interaction_ms) as avg_time_to_first_interaction_ms,
  sum(rotate_count) as rotate_count,
  sum(zoom_count) as zoom_count,
  sum(pan_count) as pan_count,
  avg(rotate_duration_ms) as avg_rotate_duration_ms,
  avg(zoom_duration_ms) as avg_zoom_duration_ms,
  avg(pan_duration_ms) as avg_pan_duration_ms
from public.sessions
group by 1;

create or replace view public.analytics_perf_daily as
select
  date_trunc('day', started_at) as day,
  coalesce(fps_bucket, 'unknown') as fps_bucket,
  avg(long_frame_count) as avg_long_frame_count,
  avg(asset_ready_ms) as avg_asset_ready_ms,
  avg(asset_download_ms) as avg_asset_download_ms,
  avg(asset_connect_ms) as avg_asset_connect_ms,
  avg(asset_dns_ms) as avg_asset_dns_ms,
  count(*) as sessions
from public.sessions
group by 1,2;

create or replace view public.analytics_reliability_daily as
select
  date_trunc('day', started_at) as day,
  count(*) filter (where e.name = 'viewer_error') as viewer_error_events,
  count(*) filter (where e.name = 'failed_asset_load') as failed_asset_load_events,
  count(*) filter (where e.name = 'telemetry_send_failed') as telemetry_send_failed_events,
  sum(s.webgl_context_lost_count) as webgl_context_lost_count,
  sum(s.webgl_context_restored_count) as webgl_context_restored_count
from public.sessions s
left join public.events e on e.session_id = s.id
group by 1;

create or replace view public.analytics_funnel_daily as
select
  date_trunc('day', s.started_at) as day,
  count(distinct s.id) as opened,
  count(distinct case when e.name = 'view_product_clicked' then s.id end) as viewed_product,
  count(distinct case when e.name = 'enquiry_clicked' then s.id end) as enquired,
  count(distinct case when e.name = 'purchase_link_clicked' then s.id end) as purchase_clicks
from public.sessions s
left join public.events e on e.session_id = s.id
group by 1;

create or replace view public.analytics_feature_time_daily as
select
  date_trunc('day', s.started_at) as day,
  e.payload->>'feature_id' as feature_id,
  avg((e.payload->>'duration_ms')::numeric) as avg_duration_ms,
  count(*) as windows
from public.events e
join public.sessions s on s.id = e.session_id
where e.name = 'feature_usage_window'
group by 1,2;
