import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'Scriptures in View';
const BASE_URL = 'https://cap-teyyko.live';
const DEFAULT_IMAGE = `${BASE_URL}/emblem-512.png`;

/**
 * Per-page SEO: title, meta description, canonical, OG, Twitter, JSON-LD.
 * @param {object} props
 * @param {string} props.title - Page title (appended with site name)
 * @param {string} props.description - Meta description (150-160 chars ideal)
 * @param {string} props.path - URL path e.g. "/about"
 * @param {string} [props.image] - OG image URL
 * @param {object} [props.jsonLd] - Additional JSON-LD structured data
 * @param {boolean} [props.noindex] - Set true for pages that shouldn't be indexed
 */
export default function SEO({ title, description, path, image, jsonLd, noindex = false }) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | Real-Time Scripture Presentation`;
  const canonical = `${BASE_URL}${path || '/'}`;
  const ogImage = image || DEFAULT_IMAGE;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta name="robots" content={noindex ? 'noindex,nofollow' : 'index,follow'} />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* JSON-LD */}
      {jsonLd && (
        <script type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </script>
      )}
    </Helmet>
  );
}
