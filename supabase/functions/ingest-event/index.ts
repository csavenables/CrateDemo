// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const requiredPayloadKeys: Record<string, string[]> = {
  interaction_start: ["type"],
  interaction_end: ["type", "duration_ms"],
  feature_usage_window: ["feature_id", "duration_ms"],
  perf_sample: ["fps_bucket"],
  asset_load_timing: ["asset_id", "ready_ms"],
  view_product_clicked: ["cta_id"],
  enquiry_clicked: ["cta_id"],
  purchase_link_clicked: ["cta_id"]
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBestEffortGeo(req: Request) {
  const country = req.headers.get("cf-ipcountry") || req.headers.get("x-vercel-ip-country") || null;
  const region = req.headers.get("x-vercel-ip-country-region") || null;
  const city = req.headers.get("x-vercel-ip-city") || null;
  return { country, region, city };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await request.json();
    if (!isObject(body) || !isObject(body.event) || !isObject(body.session)) {
      return new Response(JSON.stringify({ error: "Invalid payload shape" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const action = String(body.action || "track");
    const session = body.session as Record<string, any>;
    const event = body.event as Record<string, any>;

    const sessionId = String(session.id || "");
    const eventName = String(event.name || "");
    const eventCategory = String(event.category || "viewer");
    const eventTs = event.ts ? String(event.ts) : new Date().toISOString();
    const eventPayload = isObject(event.payload) ? event.payload : {};

    if (!sessionId || !eventName) {
      return new Response(JSON.stringify({ error: "session.id and event.name are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const required = requiredPayloadKeys[eventName] || [];
    const missing = required.filter((key) => !(key in eventPayload));
    if (missing.length > 0) {
      return new Response(JSON.stringify({
        error: "Event payload missing required keys",
        event: eventName,
        missing
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRole) {
      return new Response(JSON.stringify({ error: "Server env not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false }
    });

    const geo = getBestEffortGeo(request);

    const { error: upsertError } = await supabase
      .from("sessions")
      .upsert({
        id: sessionId,
        started_at: session.started_at || new Date().toISOString(),
        viewer_version: session.viewer_version || null,
        asset_id: session.asset_id || null,
        device_type: session.device_type || null,
        referrer: session.referrer || null,
        utm_source: session.utm_source || null,
        utm_medium: session.utm_medium || null,
        utm_campaign: session.utm_campaign || null,
        anonymous_user_id: session.anonymous_user_id || null,
        entry_page: session.entry_page || null,
        language: session.language || null,
        timezone: session.timezone || null,
        os: session.os || null,
        browser: session.browser || null,
        screen_resolution: session.screen_resolution || null,
        viewport_size: session.viewport_size || null,
        pixel_ratio: safeNumber(session.pixel_ratio),
        touch_capable: session.touch_capable ?? null,
        device_memory_gb: safeNumber(session.device_memory_gb),
        country: session.country || geo.country,
        region: session.region || geo.region,
        city: session.city || geo.city
      }, { onConflict: "id" });

    if (upsertError) throw upsertError;

    const { error: insertEventError } = await supabase
      .from("events")
      .insert({
        session_id: sessionId,
        ts: eventTs,
        name: eventName,
        category: eventCategory,
        payload: eventPayload
      });

    if (insertEventError) throw insertEventError;

    if (geo.country || geo.region || geo.city) {
      await supabase.from("events").insert({
        session_id: sessionId,
        ts: new Date().toISOString(),
        name: "location_resolved",
        category: "viewer",
        payload: {
          country: geo.country,
          region: geo.region,
          city: geo.city
        }
      });
    }

    if (action === "end" || eventName === "session_ended") {
      const durationMs = safeNumber(eventPayload.duration_ms);
      const pressCounts = isObject(eventPayload.interaction_counts) ? eventPayload.interaction_counts : null;
      const durations = isObject(eventPayload.interaction_durations_ms) ? eventPayload.interaction_durations_ms : {};

      const { error: updateError } = await supabase
        .from("sessions")
        .update({
          ended_at: new Date().toISOString(),
          duration_ms: durationMs,
          exit_page: eventPayload.exit_page || null,
          press_counts: pressCounts,
          time_to_first_interaction_ms: safeNumber(eventPayload.first_interaction_ms),
          rotate_count: safeNumber((pressCounts as any)?.rotate) ?? 0,
          zoom_count: safeNumber((pressCounts as any)?.zoom) ?? 0,
          pan_count: safeNumber((pressCounts as any)?.pan) ?? 0,
          rotate_duration_ms: safeNumber((durations as any)?.rotate),
          zoom_duration_ms: safeNumber((durations as any)?.zoom),
          pan_duration_ms: safeNumber((durations as any)?.pan),
          fps_bucket: eventPayload.fps_bucket || null,
          long_frame_count: safeNumber(eventPayload.long_frame_count),
          telemetry_send_fail_count: safeNumber(eventPayload.telemetry_send_fail_count) ?? 0,
          webgl_context_lost_count: safeNumber(eventPayload.webgl_context_lost_count) ?? 0,
          webgl_context_restored_count: safeNumber(eventPayload.webgl_context_restored_count) ?? 0
        })
        .eq("id", sessionId);

      if (updateError) throw updateError;
    }

    if (eventName === "asset_load_timing") {
      const { error: timingUpdateError } = await supabase
        .from("sessions")
        .update({
          asset_dns_ms: safeNumber(eventPayload.dns_ms),
          asset_connect_ms: safeNumber(eventPayload.connect_ms),
          asset_download_ms: safeNumber(eventPayload.download_ms),
          asset_ready_ms: safeNumber(eventPayload.ready_ms)
        })
        .eq("id", sessionId);

      if (timingUpdateError) throw timingUpdateError;
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      error: error?.message ?? String(error),
      details: error?.details ?? null,
      hint: error?.hint ?? null,
      code: error?.code ?? null
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
