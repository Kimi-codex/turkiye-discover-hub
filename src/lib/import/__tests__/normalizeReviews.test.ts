import { describe, expect, it } from "vitest";
import { MAX_IMPORTED_GOOGLE_REVIEWS, normalizeReviews } from "@/lib/import/normalize";

describe("normalizeReviews", () => {
  it("imports only the first configured Google reviews", () => {
    const reviews = normalizeReviews({
      place_id: "ChIJ_TEST",
      reviews: Array.from({ length: MAX_IMPORTED_GOOGLE_REVIEWS + 5 }, (_, index) => ({
        review_id: `review-${index}`,
        author_name: `Author ${index}`,
        rating: 5,
        text: `Review ${index}`,
        time: 1_700_000_000 + index,
      })),
    });

    expect(reviews).toHaveLength(MAX_IMPORTED_GOOGLE_REVIEWS);
    expect(reviews[0].externalReviewId).toBe("review-0");
    expect(reviews.at(-1)?.externalReviewId).toBe(`review-${MAX_IMPORTED_GOOGLE_REVIEWS - 1}`);
  });

  it("keeps valid reviews with either text or rating", () => {
    const reviews = normalizeReviews({
      place_id: "ChIJ_TEST",
      reviews: [
        { author_name: "Text only", text: "Helpful.", language: "en" },
        { author_name: "Rating only", rating: 4 },
        { author_name: "Empty" },
      ],
    });

    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      authorName: "Text only",
      rating: 5,
      reviewText: "Helpful.",
      reviewLanguage: "en",
    });
    expect(reviews[1]).toMatchObject({
      authorName: "Rating only",
      rating: 4,
      reviewText: "",
    });
  });

  it("preserves IDs, dates, and avatars from the nested scraper review shape", () => {
    const reviews = normalizeReviews({
      place_id: "ChIJ_TEST",
      reviews: [
        {
          reviewId: "camel-review-id",
          author: "Caroline R",
          rating: 5,
          text: "Useful review.",
          raw: {
            review_id: "raw-review-id",
            iso_date: "2026-07-16T18:44:20Z",
            user: {
              thumbnail: "https://lh3.googleusercontent.com/raw-avatar",
            },
          },
        },
      ],
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      externalReviewId: "camel-review-id",
      authorName: "Caroline R",
      authorAvatarUrl: "https://lh3.googleusercontent.com/raw-avatar",
      reviewDate: "2026-07-16T18:44:20Z",
    });
  });
});
