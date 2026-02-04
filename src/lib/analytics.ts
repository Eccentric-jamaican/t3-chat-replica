import posthog from "posthog-js";

const ANALYTICS_TIMEZONE = "America/New_York";
const DISTINCT_ID_KEY = "sendcat_analytics_distinct_id";
const USER_ID_KEY = "sendcat_analytics_user_id";
const SESSION_ID_KEY = "sendcat_session_id";

let analyticsInitialized = false;
const seenProductViews = new Set<string>();

const isBrowser = typeof window !== "undefined";

const getOrCreateDistinctId = () => {
  if (!isBrowser) return null;
  const existing = localStorage.getItem(DISTINCT_ID_KEY);
  if (existing) return existing;
  const newId = crypto.randomUUID();
  localStorage.setItem(DISTINCT_ID_KEY, newId);
  return newId;
};

const getSessionId = () => {
  if (!isBrowser) return "";
  const existing = localStorage.getItem(SESSION_ID_KEY);
  if (existing) return existing;
  const newId = crypto.randomUUID();
  localStorage.setItem(SESSION_ID_KEY, newId);
  return newId;
};

const getTimeProps = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ANALYTICS_TIMEZONE,
    hour: "2-digit",
    hour12: false,
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value;

  const hour = Number.parseInt(getPart("hour") || "0", 10);
  const month = Number.parseInt(getPart("month") || "1", 10);
  const day = Number.parseInt(getPart("day") || "1", 10);
  const year = Number.parseInt(getPart("year") || "1970", 10);
  const weekday = getPart("weekday") || "";
  const quarter = Math.floor((month - 1) / 3) + 1;
  const timeOfDayBucket =
    hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return {
    session_id: getSessionId(),
    timezone: ANALYTICS_TIMEZONE,
    hour_of_day_et: hour,
    day_of_week_et: weekday,
    day_of_month_et: day,
    month_et: month,
    quarter_et: `Q${quarter}`,
    year_et: year,
    time_of_day_bucket: timeOfDayBucket,
  };
};

export const initAnalytics = () => {
  if (!isBrowser || analyticsInitialized) return;
  const apiKey = import.meta.env.VITE_POSTHOG_KEY;
  if (!apiKey) return;

  const host = import.meta.env.VITE_POSTHOG_HOST || "https://app.posthog.com";
  const distinctId = getOrCreateDistinctId();

  posthog.init(apiKey, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    persistence: "localStorage",
    bootstrap: distinctId ? { distinctID: distinctId } : undefined,
  });

  if (distinctId) {
    posthog.identify(distinctId);
  }

  analyticsInitialized = true;
};

export const identifyUser = (userId: string, traits?: Record<string, unknown>) => {
  if (!isBrowser || !userId) return;
  initAnalytics();
  if (!analyticsInitialized) return;

  const guestId = getOrCreateDistinctId();
  const lastUserId = localStorage.getItem(USER_ID_KEY);
  if (guestId && guestId !== userId && lastUserId !== userId) {
    posthog.alias(userId, guestId);
  }
  posthog.identify(userId, traits);
  localStorage.setItem(USER_ID_KEY, userId);
};

export const resetAnalytics = () => {
  if (!isBrowser) return;
  if (analyticsInitialized) {
    posthog.reset();
  }
  localStorage.removeItem(DISTINCT_ID_KEY);
  localStorage.removeItem(USER_ID_KEY);
  analyticsInitialized = false;
  initAnalytics();
};

export const trackEvent = (
  name: string,
  props: Record<string, unknown> = {},
) => {
  if (!isBrowser) return;
  initAnalytics();
  if (!analyticsInitialized) return;
  posthog.capture(name, {
    ...getTimeProps(),
    ...props,
  });
};

export const trackProductView = (
  productId: string,
  props: Record<string, unknown> = {},
) => {
  if (!productId || seenProductViews.has(productId)) return;
  seenProductViews.add(productId);
  trackEvent("product_card_view", { product_id: productId, ...props });
};

export const startSessionTracking = () => {
  if (!isBrowser) return () => {};
  initAnalytics();
  if (!analyticsInitialized) return () => {};

  const sessionId = getSessionId();
  let sessionStart = Date.now();
  let activeStart = document.visibilityState === "visible" ? Date.now() : null;
  let activeTotal = 0;
  let finalized = false;

  trackEvent("session_start", { session_id: sessionId });

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      if (activeStart) {
        activeTotal += Date.now() - activeStart;
        activeStart = null;
      }
      return;
    }

    if (!activeStart) {
      activeStart = Date.now();
    }
  };

  const finalizeSession = () => {
    if (finalized) return;
    finalized = true;
    if (activeStart) {
      activeTotal += Date.now() - activeStart;
      activeStart = null;
    }
    const duration = Date.now() - sessionStart;
    trackEvent("session_summary", {
      session_id: sessionId,
      session_duration_ms: duration,
      active_time_ms: activeTotal,
      inactive_time_ms: Math.max(duration - activeTotal, 0),
    });
  };

  window.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", finalizeSession);
  window.addEventListener("beforeunload", finalizeSession);

  return () => {
    window.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", finalizeSession);
    window.removeEventListener("beforeunload", finalizeSession);
    finalizeSession();
  };
};
