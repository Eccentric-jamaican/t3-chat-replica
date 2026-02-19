# English-Speaking Caribbean E-commerce Shopper Sizing (Proxy-Based)

This extends `docs/jamaica-ecommerce-sizing.md` to an **English-speaking Caribbean** launch region.

## Countries Included

Using a pragmatic “English-speaking Caribbean first” set:

- Jamaica (`JAM`)
- Trinidad & Tobago (`TTO`)
- Barbados (`BRB`)
- The Bahamas (`BHS`)
- Guyana (`GUY`)
- Belize (`BLZ`)
- Antigua & Barbuda (`ATG`)
- Dominica (`DMA`)
- Grenada (`GRD`)
- St Kitts & Nevis (`KNA`)
- St Lucia (`LCA`)
- St Vincent & the Grenadines (`VCT`)

## Data Sources

All country metrics in this file are built from **World Bank Indicators API**:

- Online buying (Global Findex): `fin26b`
  - “Used a mobile phone or the internet to buy something online (% age 15+)”
- Internet usage: `IT.NET.USER.ZS` (% of population)
- Population: `SP.POP.TOTL`
- Ages 0–14 (% of population): `SP.POP.0014.TO.ZS` (used to approximate age 15+)

Links:

- API basic structure: https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures
- Example (Jamaica fin26b): https://api.worldbank.org/v2/country/JAM/indicator/fin26b?format=json

## Problem: fin26b Coverage Gaps

For 2021 (and earlier), `fin26b` appears **missing** for several small island states in the World Bank indicator feed (the API returns records but values are null).

To avoid “NA means zero”, we use a proxy:

1. Compute age 15+ population (approx):
   - `pop15plus ≈ pop_total * (1 - pct_0_14)`
2. Estimate annual online buyers (age 15+) as:
   - `buyers ≈ pop15plus * (internet%/100) * r`
3. Where `r` is the **share of internet users** who bought online in the past year.

We can anchor `r` using countries that *do* have both `fin26b` and internet%:

- Jamaica 2021:
  - `fin26b ≈ 16.06% (of age 15+)`
  - `internet ≈ 82.36% (of population)`
  - `r ≈ 0.195`
- Belize 2021:
  - `fin26b ≈ 18.36% (of age 15+)`
  - `internet ≈ 70.65%`
  - `r ≈ 0.260`

So we use:

- **Low**: `r = 0.195` (Jamaica)
- **Mid**: `r = 0.22`
- **High**: `r = 0.26` (Belize)

For countries where `fin26b` exists, we use the actual `fin26b` value (not the proxy).

## Results (Annual Online Buyers, Age 15+)

All values below use 2021 where available; otherwise the most recent non-null value from the API.

```
country  fin26b%  internet%  pop15+     annual buyers (low)  annual buyers (mid)  annual buyers (high)
JAM      16.06    82.36     2,268,783  364,267              364,267              364,267
TTO      NA       84.37     1,113,940  183,258              206,752              244,344
BRB      NA       77.87       231,642   35,174               39,683               46,899
BHS      NA       94.35       320,514   58,968               66,528               78,624
GUY      NA       71.65       575,398   80,394               90,701              107,192
BLZ      18.36    70.65       283,399   52,029               52,029               52,029
ATG      NA       76.05        74,947   11,115               12,540               14,820
DMA      NA       82.70        54,753    8,829                9,961               11,773
GRD      NA       70.56        92,688   12,753               14,388               17,004
KNA      NA       74.37        37,964    5,506                6,211                7,341
LCA      NA       63.06       145,580   17,902               20,198               23,870
VCT      NA       67.43        80,137   10,537               11,888               14,049

SUM annual online buyers (15+): low 840,732  mid 895,147  high 982,211
```

## Convert Annual Online Buyers → Monthly Active Shoppers

“Bought online in the past year” is not the same as “bought this month”.

To estimate **monthly active e-commerce shoppers**, we assume an annual buyer buys in `m` months per year:

- `MA shoppers ≈ annual_buyers * (m/12)`

Reasonable planning bands:

- If `m = 4` months/year: `~280k–327k` monthly active shoppers
- If `m = 6` months/year: `~420k–491k` monthly active shoppers

These totals are for the English-speaking set above, and should be treated as order-of-magnitude planning inputs (not precise census figures).

