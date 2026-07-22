/**
 * Gallery Extractor & Sanitizer for HighwayDelite Scraper
 * 
 * Extracts all gallery images from raw scraper JSON and formats them
 * into the exact database table schema:
 * 
 * [
 *   {
 *     "id": 1,
 *     "activity_id": 0,
 *     "url": "https://cdn.rzervit.com/...",
 *     "title": "Birla Industrial And Technological Museum",
 *     "description": "Main media content",
 *     "tags": ["Culture And Heritage", "Kolkata"],
 *     "meta_title": "Birla Industrial And Technological Museum",
 *     "meta_description": "Interactive science museum with exhibits...",
 *     "type": "gallery",
 *     "order": 1,
 *     "created_at": "2026-07-21T13:05:00.000Z",
 *     "updated_at": "2026-07-21T13:05:00.000Z"
 *   }
 * ]
 * 
 * Usage CLI:
 *   node gallery_extractor.js output/birla-industrial-and-technological-museum.json [activity_id]
 */

import fs from 'fs';
import path from 'path';

function cleanStr(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').trim();
}

/**
 * Format raw scraper gallery to database table format
 */
export function extractGalleryData(rawData, activityId = 0) {
  const now = new Date().toISOString();
  const hero = rawData.hero || {};
  const seo = rawData.seo || {};

  const expName = cleanStr(hero.name || rawData.slug || 'Experience');
  const city = cleanStr(hero.city);
  const category = cleanStr(hero.category);
  const tags = [category, city].filter(Boolean);

  const metaTitle = cleanStr(seo.title || expName);
  const metaDescription = cleanStr(seo.metaDescription || rawData.description?.full?.substring(0, 160) || '');

  const rawGallery = rawData.gallery || [];
  const heroImages = hero.images || [];

  const combinedImages = [];
  const seenUrls = new Set();

  // Helper to add image
  const addImg = (imgObj, defaultType = 'gallery') => {
    const url = imgObj.url || imgObj;
    if (!url || typeof url !== 'string' || seenUrls.has(url)) return;

    // Filter non-gallery images (SVGs, logos, tiny icons)
    if (url.endsWith('.svg') || url.includes('logo') || url.includes('favicon') || url.includes('map-pin')) return;

    seenUrls.add(url);
    combinedImages.push({
      rawUrl: url,
      alt: cleanStr(imgObj.alt || imgObj.title || imgObj.caption || expName),
      caption: cleanStr(imgObj.caption || imgObj.alt || ''),
      type: imgObj.type || defaultType
    });
  };

  // Add cover / hero image first
  if (hero.coverImage) addImg({ url: hero.coverImage, alt: `${expName} - Cover`, type: 'cover' });
  if (hero.heroImage) addImg({ url: hero.heroImage, alt: `${expName} - Hero`, type: 'hero' });

  // Add hero gallery images
  heroImages.forEach(img => addImg(img, 'hero_gallery'));

  // Add main gallery images
  rawGallery.forEach(img => addImg(img, 'gallery'));

  // Format into exact database schema requested (safe 32-bit integer < 2,147,483,647)
  const baseId = Math.floor(Math.random() * 1000000000) + 1000000;
  const formattedGallery = combinedImages.map((img, idx) => ({
    id: baseId + idx + 1,
    activity_id: Number(activityId) || baseId,
    url: img.rawUrl,
    title: img.alt || expName,
    description: img.caption || img.alt || expName,
    tags: tags,
    meta_title: metaTitle,
    meta_description: metaDescription,
    type: img.type || 'gallery',
    order: idx + 1,
    created_at: now,
    updated_at: now
  }));

  return formattedGallery;
}

// ─── CLI EXECUTION ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('gallery_extractor.js')) {
  const inputFile = process.argv[2] || path.join('output', 'birla-industrial-and-technological-museum.json');
  const activityId = process.argv[3] || 0;

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    const rawData = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    const galleryData = extractGalleryData(rawData, activityId);

    const dir = path.dirname(inputFile);
    const ext = path.extname(inputFile);
    const base = path.basename(inputFile, ext).replace('_sanitized', '');
    const outputFile = path.join(dir, `${base}_gallery.json`);

    fs.writeFileSync(outputFile, JSON.stringify(galleryData, null, 2), 'utf-8');

    console.log(`\n✅ Gallery extracted successfully!`);
    console.log(`📄 Saved to: ${outputFile}`);
    console.log(`📊 Total images extracted: ${galleryData.length}`);
    console.log(`\n── Sample Gallery Item ──`);
    console.log(JSON.stringify(galleryData[0], null, 2));
  } catch (err) {
    console.error(`❌ Gallery extraction failed:`, err.message);
    process.exit(1);
  }
}
