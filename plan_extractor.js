/**
 * Plan / Package Extractor for HighwayDelite Scraper
 * 
 * Transforms scraped experience package options and pricing into the exact
 * requested Plan schema format.
 * 
 * Usage CLI:
 *   node plan_extractor.js output/birla-industrial-and-technological-museum.json [activity_id]
 * 
 * Usage Module:
 *   import { extractPlanData } from './plan_extractor.js';
 *   const plan = extractPlanData(rawData, activityId);
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sanitizeData } from './sanitize.js';

function cleanStr(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').trim();
}

/**
 * Generate weekly opening info structure for plan
 */
function generateWeekOpeningInfo(price, timings = {}) {
  const dayMap = [
    { key: 'Mon', full: 'monday' },
    { key: 'Tues', full: 'tuesday' },
    { key: 'Weds', full: 'wednesday' },
    { key: 'Thur', full: 'thursday' },
    { key: 'Fri', full: 'friday' },
    { key: 'Sat', full: 'saturday' },
    { key: 'Sun', full: 'sunday' }
  ];
  const weekInfo = {};

  const openingTime = timings.openingTime || '10:00 AM';
  const closingTime = timings.closingTime || '06:00 PM';
  const closedDaysStr = (timings.closedDays || '').toLowerCase();

  dayMap.forEach(({ key, full }) => {
    const isClosed = closedDaysStr.includes(full) || closedDaysStr.includes(key.toLowerCase());
    weekInfo[key] = {
      is_Open: !isClosed,
      info: isClosed ? 'Closed' : 'Open',
      opening_Time: isClosed ? '' : openingTime,
      closing_Time: isClosed ? '' : closingTime,
      timing_Slot_List: isClosed ? [] : [
        {
          start: openingTime,
          end: closingTime,
          is_Available: true
        }
      ],
      price_PerPerson: {
        Infant: { Male: 0, Female: 0 },
        Child: { Male: price, Female: price },
        Adult: { Male: price, Female: price },
        Senior: { Male: price, Female: price }
      }
    };
  });

  return weekInfo;
}

/**
 * Format raw scraper output to Plan schema
 */
export function extractPlanData(rawData, activityId = null) {
  const hero = rawData.hero || {};
  const ticketPrices = rawData.ticketPrices || {};
  const description = rawData.description || {};
  const location = rawData.location || {};
  const timings = rawData.timings || {};

  const actSlug = rawData.slug || 'experience';
  const actName = cleanStr(hero.name || 'Experience');
  const planName = cleanStr(ticketPrices.packageName || `Entry Ticket - ${actName}`);
  const planSlug = `${actSlug}-entry-ticket`;

  const numActId = Number(activityId) || Math.floor(Math.random() * 1000000000) + 1000000;
  const planNumericId = numActId + 100;

  // Get ticket price
  const price = typeof ticketPrices.minPrice === 'number'
    ? ticketPrices.minPrice
    : parseFloat(ticketPrices.prices?.[0]?.replace(/[^\d.]/g, '') || '0') || 50;

  const currencyCode = ticketPrices.currency || 'INR';

  // Sanitized activity reference
  const sanitizedAct = sanitizeData(rawData, numActId);
  const categories = sanitizedAct.category || ['museums'];

  // Image fallback
  const imageUrl = hero.heroImage || hero.coverImage || rawData.gallery?.[0]?.url || '';

  // Format POIs as objects matching Pydantic schema (poi_id: string, admission: boolean)
  const pois = (rawData.nearbyAttractions || []).map((a, idx) => ({
    poi_id: String(Math.floor(Math.random() * 1000000000) + 1000000),
    name: cleanStr(a.name),
    url: a.url || '',
    image: a.image || '',
    distance: a.distance || '',
    category: a.category || '',
    admission: true
  })).filter(p => p.name);

  // Plan / Package Details
  const planDesc = (ticketPrices.packageDetails || []).length > 0
    ? ticketPrices.packageDetails.join('\n')
    : cleanStr(description.full?.substring(0, 300) || actName);

  const plan = {
    id: planNumericId,
    unique_id: crypto.randomUUID(),
    slug: planSlug,
    activity_id: numActId,
    activity_slug: actSlug,
    name: planName,
    info: cleanStr(description.full ? description.full.substring(0, 150) + '...' : planName),
    description: planDesc,
    type: "general",
    image_url: imageUrl,
    tags: (hero.tags || []).map(cleanStr).filter(Boolean),
    categories: categories,
    properties: {
      inclusions: rawData.inclusions || [],
      exclusions: rawData.exclusions || [],
      highlights: rawData.highlights || [],
      terms: rawData.terms || []
    },
    availability: true,
    duration: 0,
    min_purchase_count: 1,
    max_purchase_count: 10,
    week_opening_info: generateWeekOpeningInfo(price, timings),
    listing_price: {
      type: "fixed",
      final_price: price,
      currency_code: currencyCode,
      original_price: price,
      other_prices_exist: 0,
      minimum_payable_price: price
    },
    association: {
      source: "ONDC",
      productId: Math.floor(Math.random() * 90000000) + 10000000
    },
    pois: pois,
    margin: 0,
    net_price_percentage: 0
  };

  return plan;
}

// ─── CLI EXECUTION ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('plan_extractor.js')) {
  const inputFile = process.argv[2] || path.join('output', 'birla-industrial-and-technological-museum.json');
  const activityId = process.argv[3] || 0;

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    const rawData = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    const planData = extractPlanData(rawData, activityId);

    const dir = path.dirname(inputFile);
    const ext = path.extname(inputFile);
    const base = path.basename(inputFile, ext).replace('_sanitized', '').replace('_gallery', '');
    const outputFile = path.join(dir, `${base}_plan.json`);

    fs.writeFileSync(outputFile, JSON.stringify(planData, null, 2), 'utf-8');

    console.log(`\n✅ Plan details extracted successfully!`);
    console.log(`📄 Saved to: ${outputFile}`);
    console.log(`\n── Plan Summary ──`);
    console.log(`   Plan Unique ID: ${planData.unique_id}`);
    console.log(`   Plan Name: ${planData.name}`);
    console.log(`   Activity Slug: ${planData.activity_slug}`);
    console.log(`   Price: ${planData.listing_price.currency_code} ${planData.listing_price.final_price}`);
    console.log(`   Categories: ${JSON.stringify(planData.categories)}`);
    console.log(`   Mon Status: ${planData.week_opening_info.Mon.info} (${planData.week_opening_info.Mon.opening_Time} - ${planData.week_opening_info.Mon.closing_Time})`);
    console.log(`   Adult Price: ${planData.week_opening_info.Mon.price_PerPerson.Adult.Male}`);
  } catch (err) {
    console.error(`❌ Plan extraction failed:`, err.message);
    process.exit(1);
  }
}
