# Third-party code, services and data

Kestrel's own code is MIT ([LICENSE](LICENSE)). It uses the following open-source libraries, services and data, none of which are modified unless noted.

## Libraries

| Library | Use | Licence |
|---|---|---|
| [Wrangler](https://github.com/cloudflare/workers-sdk) | Build, run and deploy the Worker | MIT / Apache-2.0 |
| [supabase-js 2.45.4](https://github.com/supabase/supabase-js) (jsDelivr) | Sign-in in the browser | MIT |
| [MapLibre GL JS 4.7.1](https://github.com/maplibre/maplibre-gl-js) (jsDelivr) | 2D and 3D run routes | BSD-3-Clause |
| [pdf.js 3.11.174](https://github.com/mozilla/pdf.js) (cdnjs) | Read PDFs uploaded to build a plan | Apache-2.0 |
| [mammoth 1.6.0](https://github.com/mwilliamson/mammoth.js) (cdnjs) | Read Word files uploaded to build a plan | BSD-2-Clause |
| [SheetJS 0.18.5](https://github.com/SheetJS/sheetjs) (cdnjs) | Read spreadsheets uploaded to build a plan | Apache-2.0 |
| [Body Muscles](https://github.com/vulovix/body-muscles) (`public/vendor/body-muscles`, vendored, unmodified) | The body map | Apache-2.0 (see its LICENSE and NOTICE) |
| Bricolage Grotesque, Inter, JetBrains Mono (Google Fonts) | Type | SIL OFL 1.1 |

## Services

Cloudflare Workers, D1 and Workers AI (hosting, database, open-weight backup AI), Supabase Auth (sign-in), intervals.icu (optional watch sync, with the athlete's own key), OpenStreetMap and AWS Terrain Tiles (map and elevation), Google Gemini (first choice for the free coach; closed weights).

## Data and published methods behind the built-in models

- NRCD v2.1.0 collegiate results (Zenodo 22077479, CC BY 4.0)
- Ontario high-school championship finals (Mendeley Data 7rxh2z7vrc, CC BY 4.0)
- BMClab long-distance running dataset (Figshare 16620238, CC BY 4.0)
- World Athletics all-time lists via a Kaggle copy that states no licence (used only for KesslerPredict-Short; see [models/README.md](models/README.md))
- Riegel (1981), Daniels and Gilbert (1979), Tanda (2011): published formulas

Full model cards: [models/README.md](models/README.md).
