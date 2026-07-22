/**
 * Data Sanitizer for HighwayDelite Scraper
 * 
 * Transforms raw scraped experience JSON into the standardized target schema.
 * Map categories strictly to allowed backend schema categories.
 * 
 * Usage CLI:
 *   node sanitize.js output/birla-industrial-and-technological-museum.json
 * 
 * Usage Module:
 *   import { sanitizeData } from './sanitize.js';
 *   const sanitized = sanitizeData(rawData);
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Allowed backend categories
const ALLOWED_CATEGORIES = [
  'entertainment',
  'sports',
  'attractions',
  'transportation',
  'tours',
  'water-sports',
  'museums',
  'parks',
  'gardens',
  'beaches',
  'islands',
  'rivers',
  'mountains',
  'hills',
  'lakes',
  'theme-parks',
  'zoos',
  'historical-monuments',
  'religious-sites'
];

/**
 * Maps raw categories to allowed backend categories
 */
function mapCategory(scrapedCategory, name = '', slug = '') {
  const text = `${scrapedCategory || ''} ${name || ''} ${slug || ''}`.toLowerCase();

  // Direct allowed check
  const directMatch = ALLOWED_CATEGORIES.find(c => text.includes(c));

  if (text.includes('museum') || text.includes('gallery')) return 'museums';
  if (text.includes('temple') || text.includes('shrine') || text.includes('church') || text.includes('mosque') || text.includes('spiritual') || text.includes('religious') || text.includes('aarti') || text.includes('kashi')) return 'religious-sites';
  if (text.includes('monument') || text.includes('fort') || text.includes('palace') || text.includes('heritage') || text.includes('history') || text.includes('culture')) return 'historical-monuments';
  if (text.includes('theme') && text.includes('park')) return 'theme-parks';
  if (text.includes('park')) return 'parks';
  if (text.includes('garden')) return 'gardens';
  if (text.includes('zoo') || text.includes('safari') || text.includes('wildlife')) return 'zoos';
  if (text.includes('beach')) return 'beaches';
  if (text.includes('island')) return 'islands';
  if (text.includes('river') || text.includes('boat') || text.includes('ganges') || text.includes('ghat')) return 'rivers';
  if (text.includes('mountain')) return 'mountains';
  if (text.includes('hill')) return 'hills';
  if (text.includes('lake')) return 'lakes';
  if (text.includes('water') || text.includes('diving') || text.includes('kayak') || text.includes('rafting')) return 'water-sports';
  if (text.includes('tour') || text.includes('walk') || text.includes('sightseeing') || text.includes('expedition')) return 'tours';
  if (text.includes('sport') || text.includes('outdoor') || text.includes('trek')) return 'sports';
  if (text.includes('transport') || text.includes('taxi') || text.includes('cab') || text.includes('transfer')) return 'transportation';
  if (text.includes('show') || text.includes('event') || text.includes('entertainment') || text.includes('leisure') || text.includes('music')) return 'entertainment';

  if (directMatch) return directMatch;

  return 'attractions'; // Safe fallback
}

/**
 * Helper to generate a safe 32-bit numeric ID for PostgreSQL integer columns (< 2,147,483,647)
 */
function generateNumericId() {
  return Math.floor(Math.random() * 1000000000) + 1000000;
}

/**
 * Helper to generate a standard UUID string (e.g. "b883b329-db5e-4452-87e1-a6a9b8f4ce16")
 */
function generateUniqueStringId() {
  return crypto.randomUUID();
}

/**
 * Clean string whitespace
 */
function cleanStr(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').trim();
}

/**
 * Transform raw scraper output to target schema
 */
export function sanitizeData(rawData, customId = null) {
  const now = new Date().toISOString();
  const numericId = customId || generateNumericId();

  // Extract hero & meta
  const hero = rawData.hero || {};
  const location = rawData.location || {};
  const ticketPrices = rawData.ticketPrices || {};
  const seo = rawData.seo || {};
  const description = rawData.description || {};
  const timings = rawData.timings || {};

  const name = cleanStr(hero.name);
  const slug = rawData.slug || '';
  const rawCategory = hero.category || '';
  const uniqueStringId = generateUniqueStringId(slug);

  // Map category strictly to allowed categories enum
  const mappedCat = mapCategory(rawCategory, name, slug);

  // Image fallback chain
  const imageUrl = hero.heroImage || hero.coverImage || rawData.gallery?.[0]?.url || seo.openGraph?.['og:image'] || '';

  // Extract address parts
  const city = cleanStr(hero.city || 'Kolkata');
  const address = cleanStr(location.address || location.text || city);

  // Price calculations
  const minPrice = typeof ticketPrices.minPrice === 'number'
    ? ticketPrices.minPrice
    : parseFloat(ticketPrices.prices?.[0]?.replace(/[^\d.]/g, '') || '0') || 0;

  const currencyCode = ticketPrices.currency || 'INR';

  // Sanitized output object matching exact requested schema
  const sanitized = {
    id: numericId,
    unique_id: uniqueStringId,
    slug: slug,
    name: name,
    info: cleanStr(description.full ? description.full.substring(0, 300) + '...' : name),
    description: cleanStr(description.full),
    additional_info: cleanStr((rawData.terms || []).join('\n')),
    descriptors: (hero.tags || []).map(cleanStr).filter(Boolean),
    schedule: {
      opening_time: timings.openingTime || '',
      closing_time: timings.closingTime || '',
      closed_days: timings.closedDays || '',
      last_entry: timings.lastEntry || '',
      best_visiting_time: timings.bestVisitingTime || ''
    },
    association: {
      source: "ONDC",
      productId: Math.floor(Math.random() * 90000000) + 10000000
    },
    image_url: imageUrl,
    tags: (hero.tags || []).map(cleanStr).filter(Boolean),
    category: [mappedCat],
    availability: true,
    authorization: true,
    sold_out: false,
    website_available: true,
    ttd_available: true,
    is_featured: false,
    show_on_homepage: false,
    show_on_landingpage: false,
    partial_payment: true,
    prepaid_payment: true,
    postpaid_payment: true,
    cancellation_policy: {
      refundable: !(rawData.terms || []).some(t => t.toLowerCase().includes('non-refundable')),
      terms: rawData.terms || []
    },
    general_policy: {
      rules: rawData.rules || rawData.terms || []
    },
    refund_policy: {},
    longitude: typeof location.longitude === 'number' ? location.longitude : 0,
    latitude: typeof location.latitude === 'number' ? location.latitude : 0,
    must_know: (rawData.terms || []).map(cleanStr).filter(Boolean),
    min_duration: 0,
    max_duration: 0,
    highlights: (rawData.highlights || []).map(cleanStr).filter(Boolean),
    inclusions: (rawData.inclusions || []).map(cleanStr).filter(Boolean),
    exclusions: (rawData.exclusions || []).map(cleanStr).filter(Boolean),
    itinerary: (rawData.thingsToDo || []).map(cleanStr).filter(Boolean),
    operating_hours: [timings.openingTime, timings.closingTime].filter(Boolean).map(cleanStr),
    ticket_delivery_info: "Instant Confirmation & Digital E-Ticket",
    pois: (rawData.nearbyAttractions || []).map(a => cleanStr(a.name)).filter(Boolean),
    meta_data: {
      title: cleanStr(seo.title || name),
      description: cleanStr(seo.metaDescription || description.full?.substring(0, 160)),
      keywords: (hero.tags || []).join(', '),
      canonical_url: seo.canonical || rawData.url || '',
      image_url: seo.openGraph?.['og:image'] || imageUrl
    },
    rating: parseFloat(hero.rating) || 0,
    map_url: location.googleMapsLink || '',
    place_id: '',
    geo_accuracy: 'APPROXIMATE',
    rating_distribution: {},
    reviews_count: 0,
    duration: 0,
    listing_price: {
      type: 'fixed',
      final_price: minPrice,
      currency_code: currencyCode,
      original_price: minPrice,
      other_prices_exist: 0,
      minimum_payable_price: minPrice
    },
    landmark: '',
    address: address,
    pincode: '',
    city: city,
    city_code: city.substring(0, 3).toUpperCase(),
    state: '',
    state_code: '',
    country: 'India',
    country_code: 'IND',
    created_at: now,
    updated_at: now
  };

  return sanitized;
}

// ─── CLI EXECUTION ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('sanitize.js')) {
  const inputFile = process.argv[2] || path.join('output', 'birla-industrial-and-technological-museum.json');

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    const rawData = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    const sanitized = sanitizeData(rawData);

    const dir = path.dirname(inputFile);
    const ext = path.extname(inputFile);
    const base = path.basename(inputFile, ext);
    const outputFile = path.join(dir, `${base}_sanitized${ext}`);

    fs.writeFileSync(outputFile, JSON.stringify(sanitized, null, 2), 'utf-8');

    console.log(`\n✅ Data sanitized successfully!`);
    console.log(`📄 Saved to: ${outputFile}`);
    console.log(`\n── Category Mapping ──`);
    console.log(`   Raw Category: "${rawData.hero?.category}"`);
    console.log(`   Mapped Category: ${JSON.stringify(sanitized.category)}`);
  } catch (err) {
    console.error(`❌ Sanitization failed:`, err.message);
    process.exit(1);
  }
}
