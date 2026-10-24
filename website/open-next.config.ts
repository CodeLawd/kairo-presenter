import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// The website has static marketing pages and uncached account/API routes.
// No ISR or shared incremental cache is required yet.
export default defineCloudflareConfig({})
