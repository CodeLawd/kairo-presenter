import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/components/landing/LegalDocument";
import { isIndexable, siteName } from "@/lib/seo";

const description =
  "What personal data Kairo Presenter collects, why, who processes it, how long it's kept, and your rights.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description,
  alternates: { canonical: "/privacy" },
  robots: { index: isIndexable, follow: true },
  openGraph: { title: `Privacy Policy · ${siteName}`, description, url: "/privacy", siteName, type: "website" },
};

const CONTACT = "hello@kairopresenter.com";

const sections: LegalSection[] = [
  {
    id: "who-we-are",
    title: "Who we are",
    content: (
      <p>
        Kairo Presenter (&ldquo;Kairo&rdquo;) is provided by <strong>Joshua Alexander</strong>, based in Nigeria,
        who is the data controller for the personal data described here. Contact us about privacy at{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. This policy covers the Kairo desktop app, your Kairo account
        and the website at kairopresenter.com, and is written with the Nigeria Data Protection Act 2023 in mind.
      </p>
    ),
  },
  {
    id: "summary",
    title: "The short version",
    content: (
      <ul>
        <li>We collect what Kairo needs to run your account, your church and its services — nothing is sold or used for ads.</li>
        <li>Live audio goes to the transcription service your church connects (Deepgram); Kairo doesn&apos;t keep recordings.</li>
        <li>Sermon transcripts are uploaded to your church&apos;s account, encrypted, and kept until an admin deletes them.</li>
        <li>Crash reports and usage statistics help us fix and improve Kairo. Both can be turned off in Settings → Privacy.</li>
        <li>You can download or delete your data from the dashboard at any time, or ask us to see, correct or delete it.</li>
      </ul>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    content: (
      <>
        <h3>Your account</h3>
        <ul>
          <li>Your name, email address and password. Passwords are stored only as a secure hash (Argon2id), never in a readable form.</li>
          <li>If you sign in with Google: your Google account&apos;s email, name and profile picture.</li>
          <li>Whether your email is verified, when you last signed in, and the church you belong to.</li>
        </ul>
        <h3>Your church</h3>
        <ul>
          <li>Your church&apos;s name, time zone and service times.</li>
          <li>Who belongs to it and their roles (owner, admin, operator, viewer).</li>
        </ul>
        <h3>Signed-in computers</h3>
        <ul>
          <li>
            For each sign-in: the computer&apos;s name and hostname, operating system and version, processor type,
            app version, IP address and browser or app identifier. This keeps your account secure and lets you see
            where you&apos;re signed in.
          </li>
        </ul>
        <h3>Sermons and transcripts</h3>
        <ul>
          <li>
            When you&apos;re signed in with a verified email, each service&apos;s record is uploaded to your church
            when the service ends: its title, speaker, start and end times, the transcript (with word timings) and
            the Scripture references Kairo detected.
          </li>
          <li>A summary (recap) may be generated from the transcript and stored alongside it.</li>
        </ul>
        <h3>Service keys</h3>
        <ul>
          <li>
            Keys supplied for outside services (such as Deepgram, Anthropic, DeepSeek, API.Bible,
            Brave Search and Google Translate) are stored encrypted. Kairo manages platform provider keys centrally; church computers receive licensed service access rather than the saved platform keys.
          </li>
        </ul>
        <h3>Crash reports</h3>
        <ul>
          <li>
            If Kairo crashes, a report is sent when you&apos;re signed in: what crashed and why, your operating
            system, app version, memory and graphics status, recent errors, and the last lines of the app&apos;s
            log. We replace your home folder with &ldquo;~&rdquo;, but the log can still mention the names of songs
            or files you used.
          </li>
          <li>Crash reports are on by default. Turn them off in Settings → Privacy → Send crash reports.</li>
        </ul>
        <h3>Usage statistics</h3>
        <ul>
          <li>
            Daily counts of how features are used (for example services started, minutes listened, verses shown),
            counts of error types, and your system setup — operating system, language, processor count, memory,
            the number of screens and NDI outputs, and a few settings such as theme and default Bible translation.
            No transcripts, lyrics or slide content.
          </li>
          <li>Usage statistics are on by default. Turn them off in Settings → Privacy → Share usage statistics.</li>
          <li>When you&apos;re signed in to the web dashboard, we also record which dashboard pages are opened.</li>
        </ul>
        <h3>Downloads</h3>
        <ul>
          <li>
            When you download Kairo from the website, we record the platform, version, the page you downloaded
            from and your country. Not your IP address or who you are.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "audio-and-ai",
    title: "Live audio and AI features",
    content: (
      <>
        <p>
          These features run through outside services with access managed by Kairo or keys supplied by your church, so each provider also handles
          the data under its own privacy terms:
        </p>
        <ul>
          <li>
            <strong>Live transcription:</strong> while Kairo is listening, the microphone audio is streamed to
            Deepgram, which returns the text. Kairo doesn&apos;t store the audio.
          </li>
          <li>
            <strong>Scripture detection, sermon recaps and highlights:</strong> parts of the transcript, or all of
            it, with the sermon&apos;s title, speaker and date, are sent to Anthropic or DeepSeek, whichever your
            church uses.
          </li>
          <li>
            <strong>Bible passages:</strong> passage requests for licensed translations go to API.Bible with your
            church&apos;s key. The built-in translations (KJV, BBE and BSB) need no outside service.
          </li>
          <li>
            <strong>Finding and translating lyrics:</strong> song searches go to search services (DuckDuckGo,
            Mojeek, Brave Search, LRCLIB) and lyric websites; lyrics may be sent to DeepSeek or Google Translate to
            review or translate them.
          </li>
        </ul>
        <p>Kairo doesn&apos;t use your content to train AI models, and we don&apos;t ask these providers to.</p>
      </>
    ),
  },
  {
    id: "why",
    title: "Why we use it",
    content: (
      <ul>
        <li><strong>To provide Kairo</strong> — run your account and church, sync between computers, transcribe and detect Scripture, and make recaps. This is needed to deliver the service you asked for.</li>
        <li><strong>To keep it secure and working</strong> — protect accounts, investigate crashes and fix bugs. This is in our legitimate interest and yours.</li>
        <li><strong>To improve it</strong> — understand which features are used, using statistics you can switch off.</li>
        <li><strong>To contact you</strong> — verification codes, password resets and important service messages.</li>
        <li><strong>Where you&apos;ve agreed</strong> — for example a parent or guardian&apos;s consent for someone under 18. You can withdraw consent at any time.</li>
      </ul>
    ),
  },
  {
    id: "sharing",
    title: "Who we share it with",
    content: (
      <>
        <p>We don&apos;t sell personal data or share it for advertising. We use these providers to run Kairo:</p>
        <ul>
          <li><strong>Cloudflare</strong> — hosts the website and the Kairo service, and keeps short-term operational logs.</li>
          <li><strong>MongoDB Atlas</strong> — stores account, church, sermon, crash and usage data.</li>
          <li><strong>Brevo</strong> — sends verification, welcome and password-reset emails.</li>
          <li><strong>Google</strong> — only if you choose to sign in with Google.</li>
          <li><strong>GitHub</strong> — hosts the installers and the updates the app checks for.</li>
          <li>The services your church connects, listed in Live audio and AI features above.</li>
        </ul>
        <p>
          Inside your church, its owner and admins can see its members, sermons and recaps. We may also disclose
          data if the law requires it, or to protect people&apos;s safety or our rights.
        </p>
      </>
    ),
  },
  {
    id: "share-links",
    title: "Sermon share links",
    content: (
      <p>
        Recap links are off until a church admin turns one on. Anyone with the link can read the sermon&apos;s
        title, speaker, church name, date and summary — never the transcript. Shared pages ask search engines not
        to index them. Admins can turn a link off or replace it at any time.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    content: (
      <>
        <p>We don&apos;t use advertising or third-party analytics cookies. The website uses only what it needs to work:</p>
        <ul>
          <li><strong>pa_refresh</strong> — keeps you signed in (up to 60 days).</li>
          <li><strong>pa_google_state</strong> — protects Google sign-in, during sign-in only.</li>
          <li><strong>sidebar_state</strong> — remembers whether the dashboard sidebar is open (7 days).</li>
        </ul>
        <p>Your browser&apos;s local storage also remembers your dashboard theme and a few session details.</p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    content: (
      <ul>
        <li>Account and church details — while your account is open.</li>
        <li>Sign-in sessions — up to 60 days after your last activity.</li>
        <li>Sermons and transcripts — until a church admin deletes them, or the account is closed.</li>
        <li>Crash reports — 90 days.</li>
        <li>Usage statistics — about 13 months.</li>
        <li>Download records — kept without anything that identifies you.</li>
      </ul>
    ),
  },
  {
    id: "security",
    title: "Security",
    content: (
      <p>
        Data travels over encrypted connections (HTTPS). Passwords are hashed with Argon2id; service keys and
        sermon transcripts are encrypted at rest with AES-256-GCM. Only a small number of authorised staff can
        access crash reports and usage statistics, to support and improve Kairo. No system is perfectly secure; if
        a breach affects your data, we&apos;ll tell you and the regulator as the law requires.
      </p>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    content: (
      <p>
        Our providers run servers outside Nigeria, including in the United States and Europe, and DeepSeek in
        China if your church uses it. When data leaves Nigeria we rely on our providers&apos; security commitments
        and contractual protections, as the Nigeria Data Protection Act allows.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your rights",
    content: (
      <>
        <p>You can ask us to:</p>
        <ul>
          <li>tell you what personal data we hold about you and give you a copy;</li>
          <li>correct anything that&apos;s wrong;</li>
          <li>delete your data and close your account;</li>
          <li>send your data to you in a portable format;</li>
          <li>stop or limit using it, including withdrawing consent you&apos;ve given.</li>
        </ul>
        <p>
          You can do the two most common ones yourself: in the dashboard, under Account → Your data,{" "}
          <strong>Download my data</strong> gives you a copy of everything we hold about you as a JSON file, and{" "}
          <strong>Delete account</strong> erases your account — along with any church only you use, including its
          sermons — straight away.
        </p>
        <p>
          For anything else, or if you&apos;d rather not use the dashboard, email{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we&apos;ll respond within 30 days. You can also
          switch off crash reports and usage statistics yourself in Settings → Privacy. If you&apos;re unhappy with
          how we handle your data, you can complain to the{" "}
          <a href="https://ndpc.gov.ng" rel="noreferrer" target="_blank">Nigeria Data Protection Commission</a>.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    content: (
      <p>
        Anyone can use Kairo, but someone under 18 needs a parent or guardian&apos;s consent to create an account.
        If you believe a child has an account without that consent, contact us and we&apos;ll remove it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    content: (
      <p>
        We&apos;ll update this policy when Kairo changes how it handles data, and change the date at the top. For
        significant changes we&apos;ll let you know in the app or by email.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <p>
        Questions or requests about your data: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    ),
  },
];

export default function PrivacyPage(): React.ReactElement {
  return (
    <LegalDocument
      title="Privacy Policy"
      updated="2026-10-24"
      intro={
        <p>
          Kairo is built for churches, and churches trust it with their services and sermons. This policy explains,
          plainly, what Kairo collects, why, who helps us process it and the choices you have. It works alongside
          our <Link href="/terms">Terms of Service</Link>.
        </p>
      }
      sections={sections}
    />
  );
}
