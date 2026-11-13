The bundled rate cards are effective **2026-10-01**, checked by the dataset publisher on **2026-10-27**, downloaded **2026-11-13**.

Source: [Meta WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing).
Dataset: [Tobachat WhatsApp API rates](https://github.com/tobachat/whatsapp-api-rates), `data/latest/<currency>.json` (all 16 currencies). Data © Meta, compiled by Tobachat, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This app extracts the country mappings and standard marketing, utility, and authentication prices. Original rate-card workbooks are archived in that repository under `raw/2026-10-01`.

Meta's pricing documentation required login when checked from this environment. Rates were downloaded from the attributed dataset, not independently authenticated against Meta's live workbooks. Update the snapshot when Meta publishes a new effective card; do not use unpublished future rates for current sends.

The estimate uses the Settings currency's own rate card, never an invented exchange rate. Unsupported currencies or unresolvable recipient countries show unavailable. The range assumes 90–100% delivery and failures evenly distributed across the audience. It uses base list rates, excluding taxes, provider fees, volume discounts, free-message eligibility, and special international authentication rates. Scheduled sends may use different rates when dispatched.
