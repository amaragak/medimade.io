/** Marketing routes that use the existing `.home-hero` treatment — page pattern is off. */
const MARKETING_HERO_ROUTES = new Set([
  "/",
  "/meditate",
  "/journal",
  "/dream",
  "/focus",
]);

export function isMarketingHeroRoute(pathname: string): boolean {
  return MARKETING_HERO_ROUTES.has(pathname);
}
