# HighwayDelite ONDC Experience Scraper & Publisher

An automated Playwright-based web scraper and ONDC data transformation pipeline for extracting experience/activity data from HighwayDelite (`experiences.highwaydelite.com`) and publishing it to the production Staybook Core API.

---

## 🚀 Features

- **Automated Web Scraping (`scraper.js`)**:
  - Headless Browser extraction via Playwright.
  - Automatically handles scroll-to-bottom, cookie consent, accordion section expansions (Highlights, Terms, Inclusions).
  - API response interception for real-time pricing & availability detection.
- **ONDC Schema Transformation**:
  - **Category Mapping**: Maps raw activity categories into strict allowed backend enum literals (`museums`, `historical-monuments`, `attractions`, etc.).
  - **32-Bit PostgreSQL Safe IDs**: Generates numeric IDs compliant with PostgreSQL 32-bit integer constraints (`< 2,147,483,647`).
  - **UUID `unique_id`**: Standard UUID strings for entity identification.
  - **Association & ONDC metadata**: Maps association structure with `{ "source": "ONDC", "productId": ... }`.
- **Production Publisher (`push.js`)**:
  - Pushes Activity, Plan details, and Gallery images sequentially to `https://api.domain.com`
  - Secure API authentication via local `.env` configuration.

---

## 📁 Repository Structure

```
playwrite/
├── scraper.js           # Main scraper script (scrapes URL & extracts complete JSON)
├── sanitize.js          # Sanitizes raw scraped data into Activity schema format
├── plan_extractor.js    # Extracts package & pricing plans schema
├── gallery_extractor.js # Formats image gallery for database storage
├── bundle_extractor.js  # Merges Activity, Plans & Gallery into a single master JSON
├── push.js              # Pushes master JSON payload to Staybook Core API
├── .env                 # Environment variables (API Key & Base URL) - Git ignored
├── .gitignore           # Ignores .env, node_modules, and output directory
└── package.json         # Project dependencies & scripts
```

---

## 📦 Installation

```bash
# Clone repository
git clone https://github.com/Manish9026/ondc-scrapper.git
cd ondc-scrapper

# Install dependencies
npm install

# Install Playwright browsers (if needed)
npx playwright install chromium
```

---

## 🔑 Configuration (`.env`)

Create a `.env` file in the project root:

```env
API_BASE_URL=https://api.domain.com
CORE_SERVICE_API_KEY=your_core_service_api_key_here
```

*(Note: `.env` is git-ignored to prevent credential leaks).*

---

## 🛠️ Usage

### 1. Scrape an Experience Page

Run `scraper.js` passing the HighwayDelite target URL:

```bash
node scraper.js https://experiences.highwaydelite.com/kolkata/culture-and-heritage/birla-industrial-and-technological-museum
```

**Output**:
Generates a complete master JSON file inside `output/<slug>.json`:
- `output/birla-industrial-and-technological-museum.json`

---

### 2. Push Scraped Data to Production API

Run `push.js` with the path to the generated JSON file:

```bash
node push.js output/birla-industrial-and-technological-museum.json
```

**Workflow executed by `push.js`**:
1. `POST /api/v1/activity/activityInfo` — Creates Activity record.
2. `POST /api/v1/activity/activityInfo/{slug}/planInfo?link_pois=true&group_plan=true` — Creates Plan pricing & schedule details.
3. `POST /api/v1/activity/activitySubInfo/{slug}/imageInfo` — Uploads all gallery images sequentially.

---

## 📄 Output Data Format (`output/<slug>.json`)

```json
{
  "activity": {
    "id": 234339547,
    "unique_id": "36745332-b7e2-4646-b03a-d701d8aefd21",
    "slug": "birla-industrial-and-technological-museum",
    "name": "Birla Industrial And Technological Museum",
    "category": ["museums"],
    "association": {
      "source": "ONDC",
      "productId": 80077916
    },
    "pois": [
      "Victoria Memorial Hall",
      "Indian Museum",
      "Science City, Kolkata"
    ]
  },
  "plans": [
    {
      "id": 234339647,
      "unique_id": "848243aa-33e1-4566-a389-c40d12e9b422",
      "slug": "birla-industrial-and-technological-museum-entry-ticket",
      "type": "general",
      "week_opening_info": {
        "Mon": {
          "is_Open": true,
          "opening_Time": "10:00 AM",
          "closing_Time": "06:00 PM"
        }
      }
    }
  ],
  "gallery": [
    {
      "id": 583920192,
      "activity_id": 234339547,
      "url": "https://cdn.rzervit.com/68244315-ec9f-475e-9acd-434da3a88cbe",
      "type": "cover",
      "order": 1
    }
  ]
}
```

---

## 📜 License

ISC License
