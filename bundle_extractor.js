/**
 * Master Bundle Extractor for HighwayDelite Scraper
 * 
 * Combines Activity Info, Plans/Packages, and Gallery Images into a single,
 * properly categorized master JSON with linked activity IDs.
 * 
 * Master JSON Structure:
 * {
 *   "activity": { ... Activity Schema ... },
 *   "plans": [ { ... Plan Schema ... } ],
 *   "gallery": [ { ... Gallery Table Schema ... } ],
 *   "metadata": { ... Extraction Info ... }
 * }
 * 
 * Usage CLI:
 *   node bundle_extractor.js output/birla-industrial-and-technological-museum.json
 * 
 * Usage Module:
 *   import { extractMasterBundle } from './bundle_extractor.js';
 *   const bundle = extractMasterBundle(rawData);
 */

import fs from 'fs';
import path from 'path';
import { sanitizeData } from './sanitize.js';
import { extractPlanData } from './plan_extractor.js';
import { extractGalleryData } from './gallery_extractor.js';

/**
 * Safe 32-bit signed integer generator for PostgreSQL (max 2,147,483,647)
 */
function generateNumericId() {
  return Math.floor(Math.random() * 1000000000) + 1000000;
}

/**
 * Extract complete categorized bundle from raw scraped data
 */
export function extractMasterBundle(rawData, customActivityId = null) {
  // Shared activity numeric ID so Activity, Plans, and Gallery are linked!
  const activityId = customActivityId || generateNumericId();

  // 1. Activity Info
  const activityInfo = sanitizeData(rawData, activityId);

  // 2. Plans / Package Options
  const planInfo = extractPlanData(rawData, activityId);
  const plans = [planInfo]; // Can be expanded for multiple ticket packages

  // 3. Gallery Upload Items
  const gallery = extractGalleryData(rawData, activityId);

  // 4. Master Categorized Bundle
  const masterBundle = {
    activity: activityInfo,
    plans: plans,
    gallery: gallery,
    metadata: {
      provider: "HighwayDelite",
      source_url: rawData.url || "",
      slug: rawData.slug || "",
      scraped_at: rawData.metadata?.scrapedAt || new Date().toISOString(),
      generated_at: new Date().toISOString(),
      total_plans: plans.length,
      total_gallery_images: gallery.length
    }
  };

  return masterBundle;
}

// ─── CLI EXECUTION ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bundle_extractor.js')) {
  const inputFile = process.argv[2] || path.join('output', 'birla-industrial-and-technological-museum.json');

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    const rawData = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    const bundle = extractMasterBundle(rawData);

    const dir = path.dirname(inputFile);
    const ext = path.extname(inputFile);
    const base = path.basename(inputFile, ext).replace('_sanitized', '').replace('_gallery', '').replace('_plan', '');
    const outputFile = path.join(dir, `${base}_complete.json`);

    fs.writeFileSync(outputFile, JSON.stringify(bundle, null, 2), 'utf-8');

    console.log(`\n✅ Master bundle generated successfully!`);
    console.log(`📄 Saved to: ${outputFile}`);
    console.log(`\n── Bundle Summary ──`);
    console.log(`   Activity Name: ${bundle.activity.name}`);
    console.log(`   Activity ID: ${bundle.activity.id}`);
    console.log(`   Plans Count: ${bundle.plans.length} (ID: ${bundle.plans[0].id})`);
    console.log(`   Gallery Images Count: ${bundle.gallery.length} (Activity ID: ${bundle.gallery[0].activity_id})`);
    console.log(`   Category: ${JSON.stringify(bundle.activity.category)}`);
  } catch (err) {
    console.error(`❌ Master bundle creation failed:`, err.message);
    process.exit(1);
  }
}
