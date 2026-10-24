import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/components/landing/LegalDocument";
import { isIndexable, siteName } from "@/lib/seo";

const description =
  "The terms for using Kairo Presenter, the church presentation app, its account and its website.";

export const metadata: Metadata = {
  title: "Terms of Service",
  description,
  alternates: { canonical: "/terms" },
  robots: { index: isIndexable, follow: true },
  openGraph: { title: `Terms of Service · ${siteName}`, description, url: "/terms", siteName, type: "website" },
};

const CONTACT = "hello@kairopresenter.com";

const sections: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    content: (
      <>
        <p>
          Kairo Presenter (&ldquo;Kairo&rdquo;) is provided by <strong>Joshua Alexander</strong>, based in Nigeria
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;). These terms cover the Kairo desktop app, your Kairo account and
          church, and the website at kairopresenter.com.
        </p>
        <p>
          By downloading, installing or using Kairo, or by creating an account, you agree to these terms and to
          our <Link href="/privacy">Privacy Policy</Link>. If you use Kairo on behalf of a church or other
          organisation, you confirm you&apos;re allowed to agree to these terms for it.
        </p>
      </>
    ),
  },
  {
    id: "using-kairo",
    title: "Using Kairo",
    content: (
      <>
        <p>
          We give you a personal, non-exclusive, non-transferable right to install and use Kairo to plan and
          present services and events. Kairo itself — the app, the website and their design and code — remains
          ours.
        </p>
        <p>
          Anyone can use Kairo. If you&apos;re under 18, you need a parent or guardian&apos;s permission to create
          an account, and they agree to these terms for you.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Your account and your church",
    content: (
      <>
        <ul>
          <li>Give accurate details when you sign up, and keep them up to date.</li>
          <li>
            Keep your password and signed-in computers safe. You&apos;re responsible for what happens under your
            account; tell us straight away if you think someone else has used it.
          </li>
          <li>
            A church&apos;s admins and owner decide who joins it, what roles they have, and what happens to the
            church&apos;s data — including its sermons, recaps and stored service keys.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content",
    content: (
      <>
        <p>
          The songs, slides, media, sermons, transcripts and other material you put into Kairo stay yours. You
          give us permission to store, copy, process and display that material only as needed to run Kairo for
          you — for example, to sync it, back it up or turn a transcript into a recap.
        </p>
        <p>You&apos;re responsible for having the rights to what you show and share, including:</p>
        <ul>
          <li>a licence such as CCLI to project and record song lyrics;</li>
          <li>permission for any Bible translation that isn&apos;t in the public domain;</li>
          <li>rights to the images, videos, fonts and websites you put on screen.</li>
        </ul>
      </>
    ),
  },
  {
    id: "third-party-services",
    title: "Services you connect",
    content: (
      <>
        <p>
          Some features use outside services through keys your church adds, such as Deepgram for live
          transcription, Anthropic or DeepSeek for Scripture detection and recaps, API.Bible for licensed
          translations, and Google Translate or Brave Search for lyrics.
        </p>
        <ul>
          <li>Your use of each service is under that provider&apos;s own terms, and any charges are between you and them.</li>
          <li>You&apos;re responsible for the keys you add and for keeping within each provider&apos;s limits.</li>
          <li>We don&apos;t control these services and aren&apos;t responsible for them being available or accurate.</li>
        </ul>
      </>
    ),
  },
  {
    id: "ai",
    title: "Scripture suggestions and AI features",
    content: (
      <>
        <p>
          Live Scripture detection, transcripts, recaps and lyric tools are automated and can be wrong — a verse
          can be misheard, a passage mismatched, or a summary miss the point. Check what Kairo suggests before it
          goes on screen or is shared.
        </p>
        <p>
          If you turn on Automation, Kairo can put a detected verse on screen without anyone approving it. You
          choose whether to use it, and you remain responsible for what your screens show.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Sharing sermon recaps",
    content: (
      <p>
        A church admin can create a link to a sermon recap. Anyone with the link can read the recap&apos;s title,
        speaker, church name, date and summary — not the full transcript. Only share what your church is happy to
        make public; you can turn the link off or replace it at any time.
      </p>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    content: (
      <>
        <p>Don&apos;t use Kairo to:</p>
        <ul>
          <li>break the law or anyone else&apos;s rights, including copyright;</li>
          <li>harass, threaten or harm anyone, or show content that does;</li>
          <li>get into accounts, churches or systems that aren&apos;t yours, or test our security without permission;</li>
          <li>overload, disrupt or scrape our services, or get around their limits;</li>
          <li>copy, resell or redistribute Kairo, or reverse-engineer it except where the law allows.</li>
        </ul>
      </>
    ),
  },
  {
    id: "price",
    title: "Price",
    content: (
      <p>
        Kairo is free while it&apos;s in early access. We plan to offer paid plans later. We&apos;ll tell you
        before anything you use starts to cost money, and you&apos;ll never be charged unless you choose a paid plan.
      </p>
    ),
  },
  {
    id: "updates",
    title: "Updates and availability",
    content: (
      <>
        <p>
          We improve Kairo often and may add, change or remove features. The app checks for updates and offers to
          install them; keep it up to date so it keeps working with your account.
        </p>
        <p>
          Kairo is in early access, so expect the occasional bug. We work to keep the account and sync services
          running but can&apos;t promise they&apos;ll always be available. Presenting from the app doesn&apos;t
          depend on them, and slides, media and built-in Bibles work without the internet.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Ending your use",
    content: (
      <>
        <p>
          You can stop using Kairo whenever you like. To close your account and have your data deleted, email{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
        <p>
          We may suspend or close an account that breaks these terms or puts others at risk. Where it&apos;s fair
          and safe to, we&apos;ll tell you first and give you a chance to put things right.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    content: (
      <p>
        Kairo is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. As far as the law allows, we
        don&apos;t promise that it will be error-free, uninterrupted or right for every service or setup. Test it
        before you rely on it for a live event.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    content: (
      <>
        <p>
          As far as the law allows, we aren&apos;t liable for indirect or consequential losses, or for lost data,
          income or goodwill, arising from your use of Kairo. While Kairo is free, our total liability to you is
          limited to ₦50,000.
        </p>
        <p>Nothing in these terms limits liability that the law doesn&apos;t allow us to limit.</p>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    content: (
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria, and the courts of Nigeria have
        jurisdiction over any dispute about them. If you have a problem, please contact us first — most things can
        be sorted out quickly.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    content: (
      <p>
        We may update these terms as Kairo changes. We&apos;ll change the date at the top, and for significant
        changes we&apos;ll let you know in the app or by email before they take effect. Using Kairo after that
        means you accept the new terms.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <p>
        Questions about these terms? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    ),
  },
];

export default function TermsPage(): React.ReactElement {
  return (
    <LegalDocument
      title="Terms of Service"
      updated="2026-10-24"
      intro={
        <p>
          The rules for using Kairo, in plain language. Please read them alongside our{" "}
          <Link href="/privacy">Privacy Policy</Link>, which explains what data Kairo collects and why.
        </p>
      }
      sections={sections}
    />
  );
}
