/**
 * Placeholder id used when pre-rendering dynamic routes for static export
 * (S3 + CloudFront). Each dynamic route's generateStaticParams returns this
 * single value, and the CloudFront viewer-request function rewrites real
 * URLs (e.g. /students/abc123/) onto the placeholder's HTML.
 *
 * Kept free of "use client" so server components (page.tsx files) can
 * import it for generateStaticParams.
 */
export const STATIC_PARAM_PLACEHOLDER = "__id__";
