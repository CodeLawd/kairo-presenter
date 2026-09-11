import { Divider } from '@/components/pdf/divider/divider'
import { Heading } from '@/components/pdf/heading/heading'
import { PdfList } from '@/components/pdf/list/list'
import { PageFooter } from '@/components/pdf/page-footer/page-footer'
import { PageNumber } from '@/components/pdf/page-number/page-number'
import { Section } from '@/components/pdf/section/section'
import { Text } from '@/components/pdf/text/text'
import { PdfcnThemeProvider } from '@/components/pdf/theme-provider'
import { recapTheme } from '@/components/pdf/theme-recap'
import { Document, Page, View } from '@/lib/pdf-primitives'
import type { SermonSummary } from '@/lib/sermons'

export interface SermonRecapInput {
  title: string
  speaker: string
  /** ISO date of the service. */
  preachedAt: string
  churchName: string
  summary: SermonSummary
}

/**
 * Page margin, shared by the render options and the footer.
 *
 * They have to agree: takumi lays the footer out at full page width, outside
 * the content margin, so the footer re-applies the same value as padding to
 * line its text up with the body above it.
 */
export const RECAP_PAGE_MARGIN = 48

/** ISO A4 width — the preview sheet matches the downloaded PDF. */
export const RECAP_PAGE_WIDTH = '210mm'

/**
 * The band repeated at the foot of every page.
 *
 * Passed to `render` as its `footer` option rather than rendered inside the
 * page: takumi lays a footer out per page and resolves the page counters in
 * it, which a footer sitting in the content flow would never receive — it
 * would print once, at the end, with no numbers.
 */
export function SermonRecapFooter({
  churchName,
  title,
}: Pick<SermonRecapInput, 'churchName' | 'title'>): React.ReactElement {
  return (
    <PdfcnThemeProvider theme={recapTheme}>
      <PageFooter
        variant="simple"
        pagePadding={RECAP_PAGE_MARGIN}
        leftText={churchName || title}
        rightText={<PageNumber format="{page} / {total}" />}
      />
    </PdfcnThemeProvider>
  )
}

/** The same date wording the dashboard uses, without pulling in the browser-only helper. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The recap as a printable document.
 *
 * Dashboard preview, public share page, and PDF download all render this
 * tree, so a shared link cannot drift from what the church reviewed. The
 * primitives swap HTML for paper at the leaf; the document itself does not
 * branch on `isPdf`.
 *
 * Nothing here is invented: every section renders only if the model produced
 * it, so a sparse recap yields a short document rather than empty headings.
 */
export function SermonRecapDocument({
  title,
  speaker,
  preachedAt,
  churchName,
  summary,
}: SermonRecapInput): React.ReactElement {
  // The desktop "Service name" (e.g. "Sunday morning service"). The H1 shows
  // the AI headline once the recap is ready, so the service name joins the
  // byline instead of disappearing — unless it *is* the headline.
  const serviceName = title && title !== (summary.headline || '') ? title : null
  const byline = [serviceName, speaker, formatDate(preachedAt)].filter(Boolean).join(' · ')

  return (
    <PdfcnThemeProvider theme={recapTheme}>
      <Document title={summary.headline || title}>
        <Page size="a4">
          <Section spacing="none">
            <Text variant="xs" transform="uppercase" color="mutedForeground">
              {churchName}
            </Text>
            <Heading level={1}>{summary.headline || title}</Heading>
            {byline ? (
              <Text variant="sm" color="mutedForeground">
                {byline}
              </Text>
            ) : null}
          </Section>

          <Divider spacing="sm" />

          {summary.bigIdea ? (
            <Section spacing="none">
              <Heading level={2}>The big idea</Heading>
              <Text>{summary.bigIdea}</Text>
            </Section>
          ) : null}

          {summary.keyPoints.length > 0 ? (
            <Section spacing="none">
              <Heading level={2}>Key points</Heading>
              {summary.keyPoints.map((point, index) => (
                <View key={`${point.title}-${index}`} style={{ marginBottom: 10 }}>
                  <Heading level={3} keepWithNext>
                    {`${index + 1}. ${point.title}`}
                  </Heading>
                  <Text>{point.explanation}</Text>
                </View>
              ))}
            </Section>
          ) : null}

          {summary.memorableQuotes.length > 0 ? (
            <Section spacing="none">
              <Heading level={2}>In their words</Heading>
              {summary.memorableQuotes.map((quote, index) => (
                // Quotes are verbatim transcript, so they are set apart rather
                // than run into the body text where they would read as summary.
                <Section
                  key={`${quote.slice(0, 24)}-${index}`}
                  variant="callout"
                  accentColor="primary"
                  spacing="none"
                >
                  <Text italic noMargin>
                    {quote}
                  </Text>
                </Section>
              ))}
            </Section>
          ) : null}

          {summary.takeaways.length > 0 ? (
            <Section spacing="none">
              <Heading level={2}>This week</Heading>
              <PdfList
                variant="bullet"
                items={summary.takeaways.map((takeaway) => ({ text: takeaway }))}
              />
            </Section>
          ) : null}

          {summary.keyScriptures.length > 0 ? (
            <Section spacing="none">
              <Heading level={2}>Key scriptures</Heading>
              <PdfList
                variant="descriptive"
                items={summary.keyScriptures.map((item) => ({
                  text: item.reference,
                  description: item.connection,
                }))}
              />
            </Section>
          ) : null}

          {summary.callToAction ? (
            <Section variant="callout" accentColor="primary" spacing="none">
              <Heading level={2}>Call to action</Heading>
              <Text noMargin>{summary.callToAction}</Text>
            </Section>
          ) : null}
        </Page>
      </Document>
    </PdfcnThemeProvider>
  )
}

/**
 * The recap on a white page, matching the dashboard preview.
 *
 * The document itself is media-agnostic; this is the chrome around it when
 * it is read in the browser rather than downloaded.
 */
export function SermonRecapPreview({
  generating = false,
  ...props
}: SermonRecapInput & { generating?: boolean }): React.ReactElement {
  return (
    <article
      aria-busy={generating}
      className="relative w-full overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-32px_rgba(0,0,0,0.9)]"
    >
      {generating ? (
        <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 bg-accent motion-safe:animate-recap-bar" />
        </div>
      ) : null}
      <div
        className={`px-8 py-10 transition-opacity duration-500 ease-out md:px-12 md:py-12 ${
          generating ? 'opacity-[0.55]' : 'opacity-100'
        }`}
      >
        <SermonRecapDocument {...props} />
      </div>
      {generating ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
        >
          <div className="absolute inset-x-0 top-0 h-[200%] motion-safe:animate-recap-scan bg-[linear-gradient(to_bottom,transparent_0%,transparent_44%,rgba(245,158,11,0.08)_50%,transparent_56%,transparent_100%)]" />
        </div>
      ) : null}
    </article>
  )
}
