import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // Overview and Health are fine to index; search-result URLs are endless variations
    // of the same data, so crawlers are kept off them.
    rules: { userAgent: "*", allow: "/", disallow: "/evidence?" },
  };
}
