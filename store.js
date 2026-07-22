/**
 * HighwayDelite Experience Page Scraper v3
 * 
 * Extracts 100% of content from HighwayDelite Experience pages.
 * Uses Playwright to render the React/Next.js SPA, intercepts APIs,
 * and exhaustively clicks all interactive elements before extraction.
 *
 * Usage: node scraper.js [url]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

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

    // Helper: find the nearest sibling content container after an H2
    // This ONLY gets direct children list items, not deeply nested text
    function getSectionListItems(headingText) {
      const h2 = qsa('h2').find(h => c(h.textContent) === headingText);
      if (!h2) return [];

      // Walk siblings after the heading to find the content container
      let el = h2.nextElementSibling;
      const items = [];

      // Also check parent's next sibling
      if (!el) {
        const parent = h2.parentElement;
        el = parent?.nextElementSibling;
      }

      // Search within the parent container for list items
      const container = h2.closest('section, [class*="section"], div');
      if (container) {
        // Get only the direct <li> elements or leaf-level content divs
        const lis = container.querySelectorAll('li');
        if (lis.length > 0) {
          lis.forEach(li => {
            const t = c(li.textContent);
            if (t.length > 3 && !items.includes(t)) items.push(t);
          });
        }

        // If no <li>, try <p> tags that are actual content
        if (items.length === 0) {
          container.querySelectorAll(':scope > div > p, :scope > p, :scope > div > div > p').forEach(p => {
            const t = c(p.textContent);
            if (t.length > 5 && t !== headingText && !items.includes(t)) items.push(t);
          });
        }
      }

      return items;
    }

    // Helper: find section content by walking from H2 to next H2
    function getSectionContent(headingText) {
      const allH2 = qsa('h2');
      const h2 = allH2.find(h => c(h.textContent) === headingText);
      if (!h2) return '';

      const texts = [];
      // Get the section wrapper
      let sectionEl = h2.parentElement;
      // Find the right container level - should contain the H2 and its content
      while (sectionEl && sectionEl.querySelectorAll('h2').length > 3) {
        sectionEl = sectionEl.firstElementChild;
      }
      // Just get one level up from H2
      sectionEl = h2.parentElement;

      if (sectionEl) {
        // Get all direct text nodes and first-level elements
        const walker = document.createTreeWalker(sectionEl, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
          const t = walker.currentNode.textContent.trim();
          if (t && t.length > 2 && t !== headingText) texts.push(t);
        }
      }

      return texts.join(' ').trim();
    }

    // ── URL & Slug ──
    const url = window.location.href;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const slug = pathParts[pathParts.length - 1] || '';

    // ── Breadcrumbs ──
    const breadcrumbs = pathParts.map((part, i) => ({
      text: part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      url: norm('/' + pathParts.slice(0, i + 1).join('/'))
    }));

    // ── Hero ──
    const hero = {};
    const h1 = qs('h1');
    hero.name = h1 ? c(h1.textContent) : '';
    hero.city = pathParts[0] ? pathParts[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
    hero.category = pathParts[1] ? pathParts[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
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
      .filter(i => i.url);
    hero.heroImage = hero.images[0]?.url || hero.coverImage;

    // ── Description (the overview paragraph with Read More) ──
    // The description is the first substantial text block after the H1
    const description = {};
    // Find the description container - it's near the H1, has the "Read more" / "Show less" button
    const showLessBtn = qs('span:has(~ span), button:has(~ button)');
    // Better approach: find the paragraph near H1
    const mainContent = h1?.closest('div')?.parentElement;
    if (mainContent) {
      const pTags = mainContent.querySelectorAll('p');
      const descTexts = [];
      pTags.forEach(p => {
        const t = c(p.textContent);
        if (t.length > 50 && !t.includes('Select a date') && !t.includes('Final price') && !t.includes('Please select') && !t.includes('Your cart')) {
          descTexts.push(t);
        }
      });
      description.full = descTexts.join('\n\n');
    }

    // Fallback: grab all large paragraphs before the first H2
    if (!description.full) {
      const allP = qsa('p');
      const descTexts = [];
      for (const p of allP) {
        // Stop at first H2
        if (p.previousElementSibling?.tagName === 'H2' || p.closest('h2')) break;
        const t = c(p.textContent);
        if (t.length > 80) descTexts.push(t);
      }
      description.full = descTexts.join('\n\n');
    }

    // ── Tabs (navigation) ──
    // The page has tab buttons: Overview, Highlights, Packages, Inclusions, Terms, Location
    const tabs = [];
    qsa('button').forEach(btn => {
      const t = c(btn.textContent);
      const classList = btn.className || '';
      // Tab buttons have specific styling with rounded-[8px] and border
      if (classList.includes('rounded') && classList.includes('border') && classList.includes('min-w-fit') && t.length < 30) {
        tabs.push(t);
      }
    });
    // Fallback: look for horizontal button row
    if (tabs.length === 0) {
      const btnRow = qs('div.flex.gap-2, div.flex.gap-3, div.flex.gap-4');
      if (btnRow) {
        btnRow.querySelectorAll('button').forEach(btn => {
          const t = c(btn.textContent);
          if (t.length > 2 && t.length < 30) tabs.push(t);
        });
      }
    }

    // ── Highlights ──
    // The Highlights section is an accordion (H2 + arrow icon).
    // When expanded, it shows content below. The .highlightList class is used
    // in BOTH Highlights and Package sections, so we must scope carefully.
    const highlights = [];
    const highlightsH2 = qsa('h2').find(h => c(h.textContent) === 'Highlights');
    if (highlightsH2) {
      // The H2 is inside a clickable div. The content is a sibling of that div.
      const clickableDiv = highlightsH2.parentElement; // flex items-center gap-2 cursor-pointer
      const accordionContainer = clickableDiv?.parentElement;
      if (accordionContainer) {
        // The content appears as a sibling div after the clickable header
        const contentDiv = clickableDiv.nextElementSibling;
        if (contentDiv) {
          // Content may have .highlightList with <li> items
          const lis = contentDiv.querySelectorAll('li');
          lis.forEach(li => {
            const t = c(li.textContent);
            if (t.length > 5 && !highlights.includes(t)) highlights.push(t);
          });
          // Or it may have <p> or <span> items
          if (highlights.length === 0) {
            contentDiv.querySelectorAll('p, span').forEach(el => {
              const t = c(el.textContent);
              if (t.length > 10 && !highlights.includes(t)) highlights.push(t);
            });
          }
        }
      }
    }

    // ── Inclusions & Exclusions ──
    // DOM structure: each item is <div class="flex items-start gap-[12px]">
    //   <img alt="INCLUSIONS" or alt="Exclusions"> <span>text</span>
    // </div>
    // We use the img alt attribute to distinguish inclusions from exclusions.
    const inclusions = [];
    const exclusions = [];

    // Inclusions: find spans next to img[alt="INCLUSIONS"]
    qsa('img[alt="INCLUSIONS"]').forEach(img => {
      const span = img.parentElement?.querySelector('span');
      if (span) {
        const t = c(span.textContent);
        if (t.length > 3 && !inclusions.includes(t)) inclusions.push(t);
      }
    });

    // Exclusions: find spans next to img[alt="Exclusions"]
    qsa('img[alt="Exclusions"], img[alt="EXCLUSIONS"]').forEach(img => {
      const span = img.parentElement?.querySelector('span');
      if (span) {
        const t = c(span.textContent);
        if (t.length > 3 && !exclusions.includes(t)) exclusions.push(t);
      }
    });

    // ── Terms & Conditions ──
    // Collapsible accordion, content is <li> bullet points
    const terms = [];
    const termsH2 = qsa('h2').find(h => c(h.textContent).includes('Terms'));
    if (termsH2) {
      let parent = termsH2.parentElement;
      for (let i = 0; i < 3; i++) {
        const lis = parent?.querySelectorAll('li');
        if (lis && lis.length > 0 && lis.length < 20) {
          lis.forEach(li => {
            const t = c(li.textContent);
            if (t.length > 5 && !terms.includes(t)) terms.push(t);
          });
          break;
        }
        parent = parent?.parentElement;
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
        // Look for price text
        const text = c(container.textContent);
        const prices = text.match(/₹\s*[\d,]+/g);
        if (prices) ticketPrices.prices = [...new Set(prices)];
        ticketPrices.currency = 'INR';

        // Get package name
        ticketPrices.packageName = c(packageH3.textContent);

        // Get the description bullets (the highlight-like items in the package)
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
    const locationH2 = qsa('h2').find(h => c(h.textContent).includes('Location'));
    if (locationH2) {
      let container = locationH2.parentElement;
      for (let i = 0; i < 3; i++) {
        if (container?.children.length > 2) break;
        container = container?.parentElement;
      }
      if (container) {
        // Get location name/address spans
        const spans = container.querySelectorAll('span, p');
        const locTexts = [];
        spans.forEach(s => {
          const t = c(s.textContent);
          if (t.length > 2 && t !== 'Location Details' && !t.includes('Get Directions') && !locTexts.includes(t)) {
            locTexts.push(t);
          }
        });
        locationData.address = locTexts.join(', ');

        const mapLink = container.querySelector('a[href*="google.com/maps"]');
        if (mapLink) locationData.googleMapsLink = mapLink.href;
      }
    }
    // Get Google Maps link from anywhere on page
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

    // ── "You might also like" / Nearby Attractions ──
    const nearbyAttractions = [];
    const nearbyH2 = qsa('h2').find(h => {
      const t = c(h.textContent).toLowerCase();
      return t.includes('might also like') || t.includes('nearby') || t.includes('similar');
    });
    if (nearbyH2) {
      // Find the scrollable container with cards
      let container = nearbyH2.parentElement;
      for (let i = 0; i < 4; i++) {
        const links = container?.querySelectorAll('a[href]');
        if (links && links.length > 2) break;
        container = container?.parentElement;
      }
      if (container) {
        const seenNames = new Set();
        container.querySelectorAll('a[href*="/"]').forEach(card => {
          // Each card is an <a> with image, title, price, location
          const img = card.querySelector('img');
          const imgUrl = img ? norm(img.src || img.dataset?.src || '') : '';
          const imgAlt = img?.alt || '';

          // Get text parts - title is usually the alt text or first text node
          const allText = c(card.textContent);

          // Try to extract structured data from the card
          const spans = card.querySelectorAll('span, p, div');
          const textParts = [];
          spans.forEach(s => {
            const t = c(s.textContent);
            if (t.length > 1 && t.length < 200 && !textParts.includes(t)) textParts.push(t);
          });

          // Name: usually the alt text of the image
          const name = imgAlt || textParts[0] || '';
          if (!name || seenNames.has(name)) return;
          seenNames.add(name);

          // Price: look for ₹ pattern
          const priceText = textParts.find(t => t.includes('₹')) || '';

          // Location: look for all-caps text
          const locationText = textParts.find(t => t === t.toUpperCase() && t.length > 2 && !t.includes('₹')) || '';

          // Rating
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
    // Check for FAQ section
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
    // Also try accordions
    if (faq.length === 0) {
      qsa('details').forEach(d => {
        const q = d.querySelector('summary');
        const parts = [...d.children].filter(el => el.tagName !== 'SUMMARY');
        const a = parts.map(el => c(el.textContent)).join(' ');
        if (q && a) faq.push({ question: c(q.textContent), answer: a });
      });
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

    // ── Visible section names ──
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
  // Click Read More / Show More
  for (const text of ['Read More', 'Read more', 'Show More', 'Show more', 'See More', 'View More', 'View All', 'Show All', 'Expand']) {
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

  // Open all <details>
  await page.evaluate(() => {
    document.querySelectorAll('details:not([open])').forEach(d => d.setAttribute('open', ''));
  });

  // Expand closed accordions (aria-expanded="false")
  // But SKIP booking/cart/menu related buttons
  try {
    const closedBtns = page.locator('button[aria-expanded="false"]');
    const count = await closedBtns.count();
    for (let i = 0; i < count; i++) {
      try {
        const btn = closedBtns.nth(i);
        const text = (await btn.textContent() || '').toLowerCase();
        if (['login', 'signup', 'menu', 'cart', 'book', 'add', 'search', 'filter'].some(skip => text.includes(skip))) continue;
        if (await btn.isVisible({ timeout: 200 })) {
          await btn.click({ timeout: 1500 });
          await page.waitForTimeout(CLICK_WAIT / 2);
        }
      } catch { }
    }
  } catch { }

  // Click collapsible section headers (the H2 + arrow pattern)
  // The accordion pattern: <div class="cursor-pointer"><h2>Title</h2><img arrow></div>
  // Content div is the next sibling — it appears/hides on click
  try {
    const sectionHeaders = page.locator('h2');
    const count = await sectionHeaders.count();
    for (let i = 0; i < count; i++) {
      try {
        const h2 = sectionHeaders.nth(i);
        const text = clean(await h2.textContent());
        // Only expand content sections
        if (['Highlights', 'Terms & Conditions', 'Terms and conditions', 'Inclusions & Exclusions'].includes(text)) {
          // Click the parent clickable div (has cursor-pointer class)
          const parentDiv = await h2.evaluateHandle(el => {
            let p = el.parentElement;
            // Walk up to find the div with cursor-pointer
            for (let j = 0; j < 3; j++) {
              if (p && (p.className || '').includes('cursor-pointer')) return p;
              p = p?.parentElement;
            }
            return el.parentElement; // fallback to direct parent
          });
          try {
            await parentDiv.asElement()?.click({ timeout: 1500 });
            await page.waitForTimeout(CLICK_WAIT);
          } catch {
            // Fallback: click the H2 itself
            await h2.click({ timeout: 1500 });
            await page.waitForTimeout(CLICK_WAIT);
          }
        }
      } catch { }
    }
  } catch { }
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
const url = process.argv[2] || DEFAULT_URL;

console.log('═══════════════════════════════════════════════════');
console.log('  HighwayDelite Experience Scraper v3');
console.log('═══════════════════════════════════════════════════');
console.log(`  Target: ${url}`);
console.log('═══════════════════════════════════════════════════\n');

try {
  const data = await scrapeExperiencePage(url);

  const outputDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
  const slugName = data.slug || 'output';
  const outputPath = path.join(outputDir, 'output', `${slugName}.json`);

  fs.mkdirSync(path.join(outputDir, 'output'), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(`\n✅ Scraping complete!`);
  console.log(`📄 Output: ${outputPath}`);
  console.log(`\n📊 Results:`);
  console.log(`   Name: ${data.hero?.name || 'N/A'}`);
  console.log(`   City: ${data.hero?.city || 'N/A'} | Category: ${data.hero?.category || 'N/A'}`);
  console.log(`   Gallery: ${data.gallery?.length || 0} images`);
  console.log(`   Highlights: ${data.highlights?.length || 0} items`);
  console.log(`   Inclusions: ${data.inclusions?.length || 0} items`);
  console.log(`   Exclusions: ${data.exclusions?.length || 0} items`);
  console.log(`   Terms: ${data.terms?.length || 0} items`);
  console.log(`   FAQs: ${data.faq?.length || 0} items`);
  console.log(`   Nearby: ${data.nearbyAttractions?.length || 0} attractions`);
  console.log(`   Tabs: ${data.tabs?.join(', ') || 'none'}`);
  console.log(`   Sections: ${data.sections?.join(', ') || 'none'}`);
  console.log(`   Ticket min: ₹${data.ticketPrices?.minPrice || 'N/A'}`);
  console.log(`   Location: ${data.location?.latitude || 'N/A'}, ${data.location?.longitude || 'N/A'}`);
  console.log(`   APIs captured: ${Object.keys(data.apiResponses || {}).length}`);

  // Print actual content for verification
  console.log(`\n── Content Preview ──`);
  if (data.highlights?.length) console.log(`   Highlights: ${data.highlights.map((h,i) => `\n     ${i+1}. ${h}`).join('')}`);
  if (data.inclusions?.length) console.log(`   Inclusions: ${data.inclusions.map((h,i) => `\n     ✓ ${h}`).join('')}`);
  if (data.exclusions?.length) console.log(`   Exclusions: ${data.exclusions.map((h,i) => `\n     ✗ ${h}`).join('')}`);
  if (data.terms?.length) console.log(`   Terms: ${data.terms.map((h,i) => `\n     • ${h}`).join('')}`);
} catch (err) {
  console.error('❌ Scraping failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
