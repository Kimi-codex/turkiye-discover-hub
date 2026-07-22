#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_IMPORTED_GOOGLE_REVIEWS = 15;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.businesses)) return payload.businesses;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function unwrapRecord(record) {
  if (record?.business && typeof record.business === "object") {
    return {
      ...record.business,
      reviews: record.business.reviews ?? record.reviews,
      images: record.business.images ?? record.images,
      photos: record.business.photos ?? record.photos,
    };
  }
  if (record?.details && typeof record.details === "object") {
    return {
      ...record.details,
      reviews: record.details.reviews ?? record.reviews,
      images: record.details.images ?? record.images,
      photos: record.details.photos ?? record.photos,
    };
  }
  return record ?? {};
}

function isHttp(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function imageStats(record) {
  const imageItems = [
    ...asArray(record.photos),
    ...asArray(record.images),
    ...asArray(record.image_urls),
  ];
  let directUrls = 0;
  let sourceReferences = 0;
  for (const image of imageItems) {
    if (typeof image === "string") {
      if (isHttp(image)) directUrls += 1;
      else if (image.trim()) sourceReferences += 1;
      continue;
    }
    if (!image || typeof image !== "object") continue;
    const direct = image.url ?? image.source ?? image.src ?? image.image_url ?? image.original_url;
    const ref = image.photo_reference ?? image.photoReference ?? image.name;
    if (isHttp(direct)) directUrls += 1;
    else if (typeof ref === "string" && ref.trim()) sourceReferences += 1;
    else if (typeof direct === "string" && direct.trim()) sourceReferences += 1;
  }
  return { total: imageItems.length, directUrls, sourceReferences };
}

function reviewCount(record) {
  const candidates = [
    record.reviews,
    record.reviews_data,
    record.user_reviews,
    record.google_reviews,
    record.reviewsList,
    record.business?.reviews,
    record.details?.reviews,
  ];
  const reviews = candidates.find(Array.isArray);
  return Array.isArray(reviews) ? reviews.length : 0;
}

const input = process.argv[2] ?? "final.json";
const file = resolve(process.cwd(), input);
const payload = JSON.parse(await readFile(file, "utf8"));
const items = extractItems(payload).map(unwrapRecord);

const summary = items.reduce(
  (acc, item) => {
    const images = imageStats(item);
    const reviews = reviewCount(item);
    acc.records += 1;
    acc.recordsWithImages += images.total > 0 ? 1 : 0;
    acc.imageItems += images.total;
    acc.directImageUrls += images.directUrls;
    acc.imageSourceReferences += images.sourceReferences;
    acc.recordsWithReviews += reviews > 0 ? 1 : 0;
    acc.reviewItems += reviews;
    acc.importableReviewItems += Math.min(reviews, MAX_IMPORTED_GOOGLE_REVIEWS);
    return acc;
  },
  {
    records: 0,
    recordsWithImages: 0,
    imageItems: 0,
    directImageUrls: 0,
    imageSourceReferences: 0,
    recordsWithReviews: 0,
    reviewItems: 0,
    importableReviewItems: 0,
  },
);

console.log(JSON.stringify({ file, maxImportedGoogleReviews: MAX_IMPORTED_GOOGLE_REVIEWS, ...summary }, null, 2));
