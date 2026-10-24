# Search and sharing setup

The preferred production origin defaults to `https://kairopresenter.com`. It drives canonical links, structured data, social image URLs and the sitemap. `SITE_URL` (or `PUBLIC_WEB_URL`) can override it when changing the domain. Development and Vercel preview builds remain non-indexable. For Cloudflare staging builds, set `SITE_INDEXING=false` in both build variables and Worker runtime variables. Rebuild after changing the origin.

The homepage is currently the only indexable marketing page. `/download` is an installer-unavailable utility page, not a second marketing page. New public pages need their own title, description, canonical and explicit indexable robots metadata, and an entry in `src/app/sitemap.ts`. Do not list private routes or fragment anchors in the sitemap. Only add lastModified when it represents an actual content update.

`/robots.txt` permits public crawling and advertises `/sitemap.xml`. HTML utility pages remain crawlable so bots can read noindex directives. Root metadata defaults to noindex; account, API, download and token recap routes also get X-Robots-Tag headers. These are indexing controls, not access controls.

The supplied screenshot is served at `/brand/kairo-og.jpg` (1200 × 669) and used in Open Graph and Twitter cards. Replace this file and update its metadata dimensions together when changing the sharing artwork.

After deployment:

- Verify the domain in Google Search Console and Bing Webmaster Tools; submit `/sitemap.xml` in both.
- Inspect the homepage live URL and request indexing in Search Console.
- Validate JSON-LD with Schema.org Validator and Google Rich Results Test. Software markup has no invented price, reviews or ratings. FAQ content matches the visible questions; markup does not promise an FAQ rich result.
- Check a shared link in social preview debuggers, and monitor Search Console indexing and Core Web Vitals.

No sitemap or technical configuration guarantees rankings. Future gains should come from useful, dedicated public pages covering real church presentation workflows, with accurate copy and internal links.
