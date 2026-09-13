/**
 * Nigerian CCTV image registry.
 *
 * Previously held static base64 JPEG buffers (~1.4MB). These have been removed
 * in favour of dynamic live fetches:
 *   1. Google Street View Static API  (primary — requires GOOGLE_MAPS_SERVER_API_KEY)
 *   2. Wikimedia Commons geosearch    (keyless fallback — real geo-tagged photos)
 *   3. Synthetic SVG HUD              (final fallback — no external deps)
 *
 * The live fetch logic lives in server/providers/local.js:
 *   - wikimediaGeoImageFallback()
 *   - streetViewFallback()
 */
export const NIGERIA_CCTV_IMAGES = {};
