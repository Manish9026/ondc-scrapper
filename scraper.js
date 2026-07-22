/**
 * HighwayDelite Experience Page Scraper v4
 * 
 * Extracts 100% of content from HighwayDelite Experience pages.
 * Uses Playwright to render the React/Next.js SPA, intercepts APIs,
 * expands all section accordions, and cleanly parses each section.
 *
 * Usage: node scraper.js [url]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { sanitizeData } from './sanitize.js';
import { extractGalleryData } from './gallery_extractor.js';
import { extractPlanData } from './plan_extractor.js';
import { extractMasterBundle } from './bundle_extractor.js';

const DEFAULT_URL = 'https://experiences.highwaydelite.com/kolkata/culture-and-heritage/birla-industrial-and-technological-museum';
const VIEWPORT = { width: 1920, height: 1080 };
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const SCROLL_DELAY = 400;
const HYDRATION_WAIT = 3000;
const CLICK_WAIT = 600;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function clean(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function dedupeImages(images) {
  const seen = new Set();
  return images.filter(img => {
    if (!img.url || seen.has(img.url)) return false;
    if (img.url.endsWith('.svg')) return false;
    if (img.url.includes('logo') || img.url.includes('favicon') || img.url.includes('map-pin') || img.url.includes('arrow-down')) return false;
    seen.add(img.url);
    return true;
  });
}

// ─── MAIN SCRAPER ────────────────────────────────────────────────────────────
async function scrapeExperiencePage(targetUrl) {
  const apiResponses = {};

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    extraHTTPHeaders: {
      'ngrok-skip-browser-warning': 'true'
    }
  });

  const page = await context.newPage();

  // ── Intercept API calls ──
  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (
      ct.includes('application/json') &&
      !url.includes('.js') && !url.includes('chunk') && !url.includes('webpack') &&
      !url.includes('analytics') && !url.includes('gtag') && !url.includes('google') &&
      !url.includes('ipapi')
    ) {
      try {
        const body = await response.json();
        const key = new URL(url).pathname + new URL(url).search;
        apiResponses[key] = { url, status: response.status(), data: body };
      } catch { }
    }
  });

  console.log(`🌐 Navigating to: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
  await page.waitForTimeout(HYDRATION_WAIT);

  // ── Accept cookies ──
  for (const sel of ['button:has-text("Accept")', 'button:has-text("Got it")', 'button:has-text("OK")']) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 300 })) { await btn.click(); break; }
    } catch { }
  }

  // ── Scroll full page ──
  console.log('📜 Scrolling page...');
  await fullScroll(page);

  // ── Expand all collapsible sections ──
  console.log('🖱️ Expanding all sections...');
  await expandAllContent(page);
  await fullScroll(page);
  await page.waitForTimeout(1000);

  // ══════════════════════════════════════════════════════════════════════════
  //  EXTRACTION
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📦 Extracting data...');

  const result = await page.evaluate((baseUrl) => {
    const c = (t) => t ? t.replace(/\s+/g, ' ').trim() : '';
    const qsa = (sel) => [...document.querySelectorAll(sel)];
    const qs = (sel) => document.querySelector(sel);
    const getMeta = (name) => {
      const el = qs(`meta[name="${name}"], meta[property="${name}"]`);
      return el ? el.getAttribute('content') || '' : '';
    };
    const norm = (url) => {
      if (!url) return '';
      try {
        if (url.startsWith('data:') || url.startsWith('blob:')) return '';
        return new URL(url, baseUrl).href;
      } catch { return url; }
    };

    // ── URL & Slug ──
    const url = window.location.href;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const slug = pathParts[pathParts.length - 1] || '';

    // ── Breadcrumbs ──
    const breadcrumbs = pathParts.map((part, i) => ({
      text: part.replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()),
      url: norm('/' + pathParts.slice(0, i + 1).join('/'))
    }));

    // ── Hero ──
    const hero = {};
    const h1 = qs('h1');
    hero.name = h1 ? c(h1.textContent) : '';
    hero.city = pathParts[0] ? pathParts[0].replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()) : '';
    hero.category = pathParts[1] ? pathParts[1].replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()) : '';
    hero.coverImage = getMeta('og:image') || '';
    hero.images = qsa('img[src*="cdn.rzervit"], img[src*="cdn.delite"]')
      .slice(0, 10)
      .map((img, i) => ({
        url: norm(img.src || img.dataset.src || ''),
        alt: img.alt || '',
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        sequence: i + 1
      }))
      .filter(img => img.url);
    hero.heroImage = hero.images[0]?.url || hero.coverImage;

    // ── Description (Overview) ──
    const description = {};
    const overviewSec = qs('#overview, section[id="overview"]');
    if (overviewSec) {
      const pTags = overviewSec.querySelectorAll('p');
      const descTexts = [];
      pTags.forEach(p => {
        const t = c(p.textContent);
        if (t.length > 30 && !t.includes('Select a date') && !t.includes('Final price')) {
          descTexts.push(t);
        }
      });
      description.full = descTexts.join('\n\n');
    }
    if (!description.full) {
      const allP = qsa('p');
      const descTexts = [];
      for (const p of allP) {
        if (p.closest('h2') || p.previousElementSibling?.tagName === 'H2') break;
        const t = c(p.textContent);
        if (t.length > 50) descTexts.push(t);
      }
      description.full = descTexts.join('\n\n');
    }

    // ── Tabs ──
    const tabs = [];
    qsa('button').forEach(btn => {
      const t = c(btn.textContent);
      const classList = btn.className || '';
      if (classList.includes('rounded') && classList.includes('border') && classList.includes('min-w-fit') && t.length < 30) {
        tabs.push(t);
      }
    });

    // ── Highlights ──
    // Scoped strictly to section#highlights
    const highlights = [];
    const highlightsSec = qs('#highlights, section[id="highlights"]');
    if (highlightsSec) {
      highlightsSec.querySelectorAll('li').forEach(li => {
        const t = c(li.textContent);
        if (t.length > 3 && !highlights.includes(t)) highlights.push(t);
      });
      if (highlights.length === 0) {
        highlightsSec.querySelectorAll('p, span').forEach(el => {
          const t = c(el.textContent);
          if (t.length > 10 && t !== 'Highlights' && !highlights.includes(t)) highlights.push(t);
        });
      }
    }

    // ── Inclusions & Exclusions ──
    const inclusions = [];
    const exclusions = [];

    // Scoped strictly to images with alt="INCLUSIONS" and alt="Exclusions"
    qsa('img[alt="INCLUSIONS"], img[alt="Inclusions"]').forEach(img => {
      const span = img.parentElement?.querySelector('span');
      if (span) {
        const t = c(span.textContent);
        if (t.length > 2 && !inclusions.includes(t)) inclusions.push(t);
      }
    });

    qsa('img[alt="Exclusions"], img[alt="EXCLUSIONS"]').forEach(img => {
      const span = img.parentElement?.querySelector('span');
      if (span) {
        const t = c(span.textContent);
        if (t.length > 2 && !exclusions.includes(t)) exclusions.push(t);
      }
    });

    // ── Terms & Conditions ──
    // Scoped strictly to section#terms_and_condtions
    const terms = [];
    const termsSec = qs('#terms_and_condtions, section[id*="terms"]');
    if (termsSec) {
      termsSec.querySelectorAll('li').forEach(li => {
        const t = c(li.textContent);
        if (t.length > 3 && !terms.includes(t)) terms.push(t);
      });
      if (terms.length === 0) {
        termsSec.querySelectorAll('p, span').forEach(el => {
          const t = c(el.textContent);
          if (t.length > 10 && !t.includes('Terms & Conditions') && !terms.includes(t)) terms.push(t);
        });
      }
    }

    // ── Package / Ticket Info ──
    const ticketPrices = {};
    const packageH3 = qsa('h3').find(h => c(h.textContent).includes('Entry Ticket') || c(h.textContent).includes('Package'));
    if (packageH3) {
      let container = packageH3.parentElement;
      for (let i = 0; i < 3; i++) {
        if (container?.children.length > 2) break;
        container = container?.parentElement;
      }
      if (container) {
        const text = c(container.textContent);
        const prices = text.match(/₹\s*[\d,]+/g);
        if (prices) ticketPrices.prices = [...new Set(prices)];
        ticketPrices.currency = 'INR';
        ticketPrices.packageName = c(packageH3.textContent);

        const packageItems = [];
        container.querySelectorAll('li, .highlightList li').forEach(li => {
          const t = c(li.textContent);
          if (t.length > 5 && !packageItems.includes(t)) packageItems.push(t);
        });
        if (packageItems.length > 0) ticketPrices.packageDetails = packageItems;
      }
    }

    // ── Location ──
    const locationData = {};
    const locationSec = qs('#location, section[id="location"]');
    if (locationSec) {
      const spans = locationSec.querySelectorAll('span, p');
      const locTexts = [];
      spans.forEach(s => {
        const t = c(s.textContent);
        if (t.length > 2 && t !== 'Location Details' && !t.includes('Get Directions') && !locTexts.includes(t)) {
          locTexts.push(t);
        }
      });
      locationData.address = locTexts.join(', ');
      const mapLink = locationSec.querySelector('a[href*="google.com/maps"]');
      if (mapLink) locationData.googleMapsLink = mapLink.href;
    }
    const globalMapLink = qs('a[href*="google.com/maps"]');
    if (globalMapLink && !locationData.googleMapsLink) {
      locationData.googleMapsLink = globalMapLink.href;
    }
    if (locationData.googleMapsLink) {
      const match = locationData.googleMapsLink.match(/query=([-\d.]+)%2C([-\d.]+)/);
      if (match) {
        locationData.latitude = parseFloat(match[1]);
        locationData.longitude = parseFloat(match[2]);
      }
    }

    // ── Nearby Attractions ("You might also like") ──
    const nearbyAttractions = [];
    const nearbyH2 = qsa('h2').find(h => {
      const t = c(h.textContent).toLowerCase();
      return t.includes('might also like') || t.includes('nearby') || t.includes('similar');
    });
    if (nearbyH2) {
      let container = nearbyH2.parentElement;
      for (let i = 0; i < 4; i++) {
        const links = container?.querySelectorAll('a[href]');
        if (links && links.length > 2) break;
        container = container?.parentElement;
      }
      if (container) {
        const seenNames = new Set();
        container.querySelectorAll('a[href*="/"]').forEach(card => {
          const img = card.querySelector('img');
          const imgUrl = img ? norm(img.src || img.dataset?.src || '') : '';
          const imgAlt = img?.alt || '';

          const spans = card.querySelectorAll('span, p, div');
          const textParts = [];
          spans.forEach(s => {
            const t = c(s.textContent);
            if (t.length > 1 && t.length < 200 && !textParts.includes(t)) textParts.push(t);
          });

          const name = imgAlt || textParts[0] || '';
          if (!name || seenNames.has(name)) return;
          seenNames.add(name);

          const priceText = textParts.find(t => t.includes('₹')) || '';
          const locationText = textParts.find(t => t === t.toUpperCase() && t.length > 2 && !t.includes('₹')) || '';
          const ratingText = textParts.find(t => /^\d\.\d/.test(t)) || '';

          nearbyAttractions.push({
            name,
            url: norm(card.href),
            image: imgUrl,
            price: priceText,
            location: locationText,
            rating: ratingText,
          });
        });
      }
    }

    // ── FAQs ──
    const faq = [];
    const faqH2 = qsa('h2, h3').find(h => c(h.textContent).toLowerCase().includes('faq'));
    if (faqH2) {
      let container = faqH2.parentElement;
      for (let i = 0; i < 4; i++) {
        if (container?.children.length > 3) break;
        container = container?.parentElement;
      }
      if (container) {
        container.querySelectorAll('details, [data-state]').forEach(item => {
          const q = item.querySelector('summary, button, [class*="trigger"]');
          const a = item.querySelector('[class*="content"], [role="region"], p');
          if (q && a) {
            faq.push({ question: c(q.textContent), answer: c(a.textContent) });
          }
        });
      }
    }

    // ── Gallery ──
    const gallery = [];
    const seenUrls = new Set();
    qsa('img').forEach(img => {
      let imgUrl = norm(img.src || img.dataset?.src || '');
      const srcset = img.srcset || img.dataset?.srcset || '';
      if (srcset) {
        const srcs = srcset.split(',').map(s => s.trim().split(/\s+/));
        const sorted = srcs.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0));
        if (sorted[0]) imgUrl = norm(sorted[0][0]) || imgUrl;
      }
      if (!imgUrl || seenUrls.has(imgUrl)) return;
      if (imgUrl.endsWith('.svg')) return;
      if (imgUrl.includes('logo') || imgUrl.includes('favicon') || imgUrl.includes('map-pin') || imgUrl.includes('arrow-down')) return;
      seenUrls.add(imgUrl);
      gallery.push({
        url: imgUrl,
        alt: img.alt || '',
        caption: img.title || '',
        sequence: gallery.length + 1,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0
      });
    });

    // ── SEO ──
    const seo = {
      title: document.title || '',
      metaDescription: getMeta('description'),
      canonical: qs('link[rel="canonical"]')?.href || '',
      robots: getMeta('robots'),
      language: document.documentElement.lang || '',
      themeColor: getMeta('theme-color'),
      openGraph: {},
      twitterCard: {},
      favicons: []
    };
    qsa('meta[property^="og:"]').forEach(m => {
      seo.openGraph[m.getAttribute('property')] = m.getAttribute('content') || '';
    });
    qsa('meta[name^="twitter:"], meta[property^="twitter:"]').forEach(m => {
      const key = m.getAttribute('name') || m.getAttribute('property');
      seo.twitterCard[key] = m.getAttribute('content') || '';
    });
    qsa('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(l => {
      seo.favicons.push({ rel: l.rel, href: norm(l.href), sizes: l.getAttribute('sizes') || '' });
    });

    // ── JSON-LD ──
    const structuredData = {};
    qsa('script[type="application/ld+json"]').forEach((script, i) => {
      try {
        const data = JSON.parse(script.textContent);
        structuredData[data['@type'] || `schema_${i}`] = data;
      } catch { }
    });

    const visibleSections = [...new Set(qsa('h2').map(h => c(h.textContent)).filter(t => t.length > 0 && t.length < 80))];

    return {
      url,
      slug,
      breadcrumbs,
      hero,
      gallery,
      description,
      highlights,
      inclusions,
      exclusions,
      terms,
      ticketPrices,
      location: locationData,
      nearbyAttractions,
      faq,
      tabs,
      seo,
      structuredData,
      sections: visibleSections,
      metadata: {
        scrapedAt: new Date().toISOString(),
        pageUrl: url,
        totalImages: gallery.length,
      }
    };
  }, targetUrl);

  // ── Merge API data ──
  result.apiResponses = {};
  for (const [key, value] of Object.entries(apiResponses)) {
    if (key.includes('ipapi') || key.includes('track/init') || key.includes('track/event')) continue;
    result.apiResponses[key] = value;
  }

  // ── Ticket pricing from bookable dates API ──
  for (const [key, value] of Object.entries(apiResponses)) {
    if (key.includes('bookabledates') && value.data?.data) {
      const dates = value.data.data;
      if (dates.length > 0) {
        result.ticketPrices.minPrice = dates[0].minPrice;
        result.ticketPrices.currency = 'INR';
        result.ticketPrices.capacity = dates[0].capacity;
        result.ticketPrices.bookableDates = dates.map(d => ({
          date: d.date, minPrice: d.minPrice, capacity: d.capacity
        }));
      }
    }
  }

  await browser.close();
  result.gallery = dedupeImages(result.gallery);
  return result;
}

// ─── SCROLL ──────────────────────────────────────────────────────────────────
async function fullScroll(page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  let pos = 0;
  while (pos < height) {
    pos += VIEWPORT.height * 0.7;
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), pos);
    await page.waitForTimeout(SCROLL_DELAY);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await page.waitForTimeout(500);
}

// ─── EXPAND ──────────────────────────────────────────────────────────────────
async function expandAllContent(page) {
  // 1. Expand specific sections by ID if collapsed: #highlights, #terms_and_condtions
  for (const id of ['highlights', 'terms_and_condtions']) {
    try {
      const section = page.locator(`#${id}`);
      if (await section.count() > 0) {
        const isCollapsed = await section.evaluate(sec => {
          // If section already has list items or text container, it's expanded
          if (sec.querySelector('ul, li, ol, p')) return false;
          const img = sec.querySelector('img[alt*="ARROW"], img[alt*="arrow"]');
          if (img && img.style.transform.includes('180deg')) return false;
          return true;
        });
        if (isCollapsed) {
          const clickable = section.locator('.cursor-pointer, h2').first();
          if (await clickable.isVisible()) {
            await clickable.click();
            await page.waitForTimeout(CLICK_WAIT);
          }
        }
      }
    } catch { }
  }

  // 2. Click Read More / Show More buttons
  for (const text of ['Read More', 'Read more', 'Show More', 'Show more', 'See More', 'View More', 'Expand']) {
    for (const tag of ['button', 'span', 'a', 'div']) {
      try {
        const loc = page.locator(`${tag}:has-text("${text}")`);
        const count = await loc.count();
        for (let i = 0; i < count; i++) {
          try {
            const el = loc.nth(i);
            if (await el.isVisible({ timeout: 200 })) {
              await el.click({ timeout: 1500 });
              await page.waitForTimeout(CLICK_WAIT);
            }
          } catch { }
        }
      } catch { }
    }
  }

  // 3. Open all <details>
  await page.evaluate(() => {
    document.querySelectorAll('details:not([open])').forEach(d => d.setAttribute('open', ''));
  });
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
const url = process.argv[2] || DEFAULT_URL;

console.log('═══════════════════════════════════════════════════');
console.log('  HighwayDelite Experience Scraper v4');
console.log('═══════════════════════════════════════════════════');
console.log(`  Target: ${url}`);
console.log('═══════════════════════════════════════════════════\n');

try {
  const data = await scrapeExperiencePage(url);

  const outputDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
  const slugName = data.slug || 'output';
  const masterOutputPath = path.join(outputDir, 'output', `${slugName}.json`);

  const masterBundle = extractMasterBundle(data);

  fs.mkdirSync(path.join(outputDir, 'output'), { recursive: true });
  fs.writeFileSync(masterOutputPath, JSON.stringify(masterBundle, null, 2), 'utf-8');

  console.log(`\n✅ Scraping & Master Extraction complete!`);
  console.log(`📄 Complete JSON Output: ${masterOutputPath}`);
  console.log(`\n📊 Master Bundle Summary:`);
  console.log(`   Activity Name: ${masterBundle.activity.name}`);
  console.log(`   Activity ID: ${masterBundle.activity.id}`);
  console.log(`   Plans Count: ${masterBundle.plans.length} (ID: ${masterBundle.plans[0].id})`);
  console.log(`   Gallery Images Count: ${masterBundle.gallery.length}`);
  console.log(`   Category: ${JSON.stringify(masterBundle.activity.category)}`);
  console.log(`   City: ${masterBundle.activity.city} | Country: ${masterBundle.activity.country}`);

  console.log(`\n── Activity Content Preview ──`);
  if (data.highlights?.length) console.log(`   Highlights:\n` + data.highlights.map((h, i) => `     ${i + 1}. ${h}`).join('\n'));
  if (data.inclusions?.length) console.log(`   Inclusions:\n` + data.inclusions.map((h) => `     ✓ ${h}`).join('\n'));
  if (data.exclusions?.length) console.log(`   Exclusions:\n` + data.exclusions.map((h) => `     ✗ ${h}`).join('\n'));
  if (data.terms?.length) console.log(`   Terms:\n` + data.terms.map((h) => `     • ${h}`).join('\n'));
} catch (err) {
  console.error('❌ Scraping failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
