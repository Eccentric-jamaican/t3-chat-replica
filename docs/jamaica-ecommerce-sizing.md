# Jamaica E-commerce Shopper Sizing (Proxy-Based)

Goal: estimate **monthly active e-commerce shoppers in Jamaica** using the most “real” numbers we can get publicly (courier volumes + survey data), and clearly separate **facts** from **assumptions**.

## What “Monthly Active Shopper” Means Here

For this note, a “monthly active e-commerce shopper” means: **a person who buys something online at least once in a given month** (domestic or cross-border).

This is different from:

- **Annual online buyers**: people who bought online at least once in the last 12 months.
- **Concurrent users** (capacity planning): people actively using the app at the same moment.

## Hard-ish Public Anchors

### 1) Courier/package proxy (Mailpac + MyCart Express)

Jamaica Observer reporting states **Mailpac + MyCart Express deliver “over 1.5 million packages annually.”**

If we treat that as ~`1.5M / 12 ≈ 125k packages/month` average, you can back out a **monthly active shopper** range by assuming **packages per active shopper per month**:

- If `1.0` package per active shopper per month: ~`125k` monthly active shoppers.
- If `2.0` packages per active shopper per month: ~`62.5k` monthly active shoppers.
- If `3.0` packages per active shopper per month: ~`41.7k` monthly active shoppers.

This proxy is useful because it’s based on operational throughput (packages), but it has known distortions:

- “Packages” ≠ “people” (some users are heavy buyers; some shipments bundle multiple items).
- Mailpac/MyCart are big, but not the whole market (direct-to-home deliveries, other couriers, local merchants, etc.).

### 2) Survey proxy (World Bank indicator: “bought something online in past year”)

World Bank indicator `fin26b` reports Jamaica’s **% of age 15+ who used a mobile phone or the internet to buy something online (past year)** as:

- **2021: ~16.06%**

Using World Bank population (2021 total population) and share ages 0–14 to approximate age 15+ population:

- 2021 population: **2,837,682**
- Ages 0–14: **~20.05%**
- Approx age 15+: `2,837,682 * (1 - 0.2005) ≈ 2,268,783`
- Annual online buyers (age 15+): `2,268,783 * 0.1606 ≈ 364k people/year`

Converting “annual online buyers” to **monthly active** requires an assumption about **how many months per year** an average buyer actually makes a purchase:

- If an annual buyer buys in ~2 months/year on average: `364k * (2/12) ≈ 61k` monthly active.
- If ~4 months/year: `364k * (4/12) ≈ 121k` monthly active.
- If ~6 months/year: `364k * (6/12) ≈ 182k` monthly active.

This aligns surprisingly well with the package-volume proxy if the “typical” buyer averages ~4 packages/year (which yields `364k * 4 ≈ 1.46M packages/year`, close to the “>1.5M packages annually” anchor).

## Conservative Sizing Takeaway (What I’d Use)

Given the two independent anchors above, a conservative working range for **monthly active e-commerce shoppers in Jamaica** is:

- **~60k to ~180k monthly active shoppers**

If you need a single “planning” point estimate, use **~100k–125k** as a reasonable mid.

## Mailpac Financials (Cross-check Only)

Mailpac Group’s published annual report states **2024 revenues of J$2.56B** (up from J$1.67B in 2023).

This can be used as a coarse plausibility check:

- If you naively divide `J$2.56B / 1.5M packages ≈ J$1,700/package`,
  that’s not obviously crazy for a courier/logistics + services business (but this is *not* a clean metric because revenue includes more than per-package fees).

## What I Could Not Reliably Find (Yet)

- **FedEx Jamaica**: I couldn’t find any credible public breakdown of Jamaica-only shipment volumes or monthly active shopper stats. FedEx tends not to publish country-level parcel volumes for small markets.

## Next “Better Data” Upgrades (If You Want Tighter Bounds)

- Pull **import duty/parcel count** data from Jamaica Customs (if published) or request it via access-to-information channels.
- Look for any **GST/VAT e-commerce** reporting (merchant count, transaction count).
- Get “active customers” or “unique customers per month” from Mailpac (sometimes disclosed in investor decks/annual report MD&A, but I didn’t see it in the 2024 annual report text I extracted).

## Sources (Links)

- Jamaica Observer (Mailpac/MyCart Express “over 1.5 million packages annually”): https://www.jamaicaobserver.com/2024/05/22/mailpac-growing-momentum/
- World Bank API (indicator `fin26b`, Jamaica): https://api.worldbank.org/v2/country/JAM/indicator/fin26b?format=json
- World Bank API (population total, Jamaica): https://api.worldbank.org/v2/country/JAM/indicator/SP.POP.TOTL?format=json
- World Bank API (population ages 0-14 %, Jamaica): https://api.worldbank.org/v2/country/JAM/indicator/SP.POP.0014.TO.ZS?format=json
- Mailpac annual report PDF (2024): https://cdn.jamstockex.com/pd/2025/07/MailPac-Annual-Report-2024.pdf
