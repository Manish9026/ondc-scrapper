#!/usr/bin/env node
/**
 * push.js — Pushes scraped activity data to the production API
 *
 * Usage:
 *   node push.js <path-to-complete-json>
 *
 * Example:
 *   node push.js output/national-gallery-of-modern-art.json
 *   node push.js output/birla-industrial-and-technological-museum.json
 *
 * Requires .env file with:
 *   API_BASE_URL=https://core.staybook.in
 *   CORE_SERVICE_API_KEY=<your-key>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// ─── Load .env ──────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env') });

const API_BASE_URL = (process.env.API_BASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.CORE_SERVICE_API_KEY;

if (!API_BASE_URL || !API_KEY) {
  console.error('❌  Missing API_BASE_URL or CORE_SERVICE_API_KEY in .env');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function apiRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  return { status: res.status, ok: res.ok, data: json };
}

function printSection(title) {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(55));
}

function printResult(label, status, ok, detail = '') {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon}  [${status}] ${label}${detail ? ' → ' + detail : ''}`);
}

// ─── Push Activity ───────────────────────────────────────────────────────────
async function pushActivity(activity) {
  printSection('1/3  Activity Info');
  const url = `${API_BASE_URL}/api/v1/activity/activityInfo`;
  console.log(`   POST ${url}`);
  console.log(`   Slug : ${activity.slug}`);
  console.log(`   Name : ${activity.name}`);

  const { status, ok, data } = await apiRequest('POST', url, activity);
  printResult('Activity created', status, ok, data?.slug || data?.detail || '');
  if (!ok) {
    console.error('   Response body:', JSON.stringify(data, null, 2));
  }
  return ok;
}

// ─── Push Plans ─────────────────────────────────────────────────────────────
async function pushPlans(plans, activitySlug) {
  printSection('2/3  Plan Info');
  let allOk = true;

  for (const [i, plan] of plans.entries()) {
    const url = `${API_BASE_URL}/api/v1/activity/activityInfo/${activitySlug}/planInfo?link_pois=true&group_plan=true`;
    console.log(`\n   Plan ${i + 1}/${plans.length}: "${plan.name}"`);
    console.log(`   POST ${url}`);

    const { status, ok, data } = await apiRequest('POST', url, plan);
    printResult('Plan created', status, ok, data?.slug || data?.detail || '');
    if (!ok) {
      console.error('   Response body:', JSON.stringify(data, null, 2));
      allOk = false;
    }
    if (i < plans.length - 1) await sleep(300);
  }
  return allOk;
}

// ─── Push Gallery Images ─────────────────────────────────────────────────────
async function pushGallery(gallery, activitySlug) {
  printSection('3/3  Image Gallery');
  let allOk = true;
  let successCount = 0;

  for (const [i, image] of gallery.entries()) {
    const url = `${API_BASE_URL}/api/v1/activity/activitySubInfo/${activitySlug}/imageInfo`;
    process.stdout.write(`   [${i + 1}/${gallery.length}] Uploading "${image.title}" ... `);

    const { status, ok, data } = await apiRequest('POST', url, image);
    if (ok) {
      successCount++;
      process.stdout.write(`✅  [${status}]\n`);
    } else {
      process.stdout.write(`❌  [${status}]\n`);
      console.error('      Response:', JSON.stringify(data, null, 2));
      allOk = false;
    }
    if (i < gallery.length - 1) await sleep(200);
  }

  console.log(`\n   Uploaded: ${successCount}/${gallery.length} images`);
  return allOk;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node push.js <path-to-complete-json>');
    console.error('Example: node push.js output/national-gallery-of-modern-art.json');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`❌  File not found: ${absPath}`);
    process.exit(1);
  }

  const bundle = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  const { activity, plans = [], gallery = [] } = bundle;

  if (!activity) {
    console.error('❌  JSON must have an "activity" key. Is this a _complete.json?');
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  Push to Production`);
  console.log(`║  Target : ${API_BASE_URL}`);
  console.log(`║  Activity: ${activity.name}`);
  console.log(`║  Slug   : ${activity.slug}`);
  console.log(`║  Plans  : ${plans.length}   |  Images: ${gallery.length}`);
  console.log('╚══════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  // 1. Activity
  const activityOk = await pushActivity(activity);
  if (!activityOk) {
    console.error('\n⚠️   Activity creation failed. Plans & images will still be attempted.\n');
  }

  await sleep(500);

  // 2. Plans
  let plansOk = true;
  if (plans.length > 0) {
    plansOk = await pushPlans(plans, activity.slug);
  } else {
    console.log('\n⚠️   No plans found in JSON — skipping plan creation.');
  }

  await sleep(500);

  // 3. Gallery
  let galleryOk = true;
  if (gallery.length > 0) {
    galleryOk = await pushGallery(gallery, activity.slug);
  } else {
    console.log('\n⚠️   No gallery images found — skipping image upload.');
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  Push Summary');
  console.log(`║  Activity : ${activityOk ? '✅ Created' : '❌ Failed'}`);
  console.log(`║  Plans    : ${plansOk ? '✅ All created' : '⚠️  Some failed'}`);
  console.log(`║  Images   : ${galleryOk ? '✅ All uploaded' : '⚠️  Some failed'}`);
  console.log(`║  Duration : ${elapsed}s`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  if (!activityOk || !plansOk || !galleryOk) process.exit(1);
}

main().catch(err => {
  console.error('❌  Unhandled error:', err.message);
  process.exit(1);
});
