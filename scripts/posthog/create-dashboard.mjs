/* eslint-disable no-console */
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const host = process.env.POSTHOG_HOST || "https://us.posthog.com";
const dashboardName =
  process.env.POSTHOG_DASHBOARD_NAME || "Sendcat Core Analytics";

if (!apiKey || !projectId) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID in the environment.",
  );
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
};

const postJson = async (path, body) => {
  const response = await fetch(`${host}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `POST ${path} failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`,
    );
  }
  return payload;
};

const buildTrendsQuery = (eventName, options = {}) => ({
  kind: "InsightVizNode",
  source: {
    kind: "TrendsQuery",
    series: [
      {
        kind: "EventsNode",
        name: eventName,
        event: eventName,
        math: "total",
        version: 1,
        ...(options.math ? { math: options.math } : {}),
        ...(options.math_property ? { math_property: options.math_property } : {}),
      },
    ],
    interval: "day",
    dateRange: {
      date_from: "-30d",
      date_to: null,
    },
    ...Object.fromEntries(
      Object.entries(options).filter(
        ([key]) => key !== "math" && key !== "math_property",
      ),
    ),
    version: 1,
  },
  version: 1,
});

const insights = [
  {
    name: "Sign-up views (daily)",
    query: buildTrendsQuery("sign_up_view"),
  },
  {
    name: "Sign-ups completed (daily)",
    query: buildTrendsQuery("sign_up_completed"),
  },
  {
    name: "Searches submitted (daily)",
    query: buildTrendsQuery("search_submitted"),
  },
  {
    name: "Product drawer opens (daily)",
    query: buildTrendsQuery("product_drawer_open"),
  },
  {
    name: "Visit merchant clicks (daily)",
    query: buildTrendsQuery("visit_merchant_click"),
  },
  {
    name: "Favorites added (daily)",
    query: buildTrendsQuery("favorite_added"),
  },
  {
    name: "Messages sent (daily)",
    query: buildTrendsQuery("message_send"),
  },
  {
    name: "LLM cost (daily)",
    query: buildTrendsQuery("llm_usage", {
      math: "sum",
      math_property: "cost",
    }),
  },
  {
    name: "LLM tokens (daily)",
    query: buildTrendsQuery("llm_usage", {
      math: "sum",
      math_property: "total_tokens",
    }),
  },
  {
    name: "LLM usage by model",
    query: buildTrendsQuery("llm_usage", {
      breakdown: "model_id",
      breakdown_type: "event",
    }),
  },
  {
    name: "LLM quality feedback",
    query: buildTrendsQuery("llm_quality_feedback", {
      breakdown: "response",
      breakdown_type: "event",
    }),
  },
  {
    name: "Time of day usage (messages)",
    query: buildTrendsQuery("message_send", {
      breakdown: "time_of_day_bucket",
      breakdown_type: "event",
    }),
  },
  {
    name: "Seasonality (monthly messages)",
    query: buildTrendsQuery("message_send", {
      breakdown: "month_et",
      breakdown_type: "event",
      interval: "month",
    }),
  },
];

const main = async () => {
  console.log("Creating dashboard...");
  const dashboard = await postJson(`/api/projects/${projectId}/dashboards/`, {
    name: dashboardName,
    description: "Auto-generated Sendcat analytics dashboard.",
    pinned: true,
  });

  console.log(`Dashboard created: ${dashboard.id}`);

  for (const insight of insights) {
    try {
      const created = await postJson(
        `/api/projects/${projectId}/insights/`,
        {
          name: insight.name,
          query: insight.query,
          dashboards: [dashboard.id],
        },
      );
      console.log(`  ✔ Insight created: ${created.id} (${insight.name})`);
    } catch (error) {
      console.error(`  ✖ Failed to create insight "${insight.name}"`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log("Done.");
};

main().catch((error) => {
  console.error("Failed to create dashboard:", error);
  process.exit(1);
});
