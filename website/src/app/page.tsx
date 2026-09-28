import { Fragment } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import "./landing.css";

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1440px] md:w-[calc(100%-48px)] xl:w-[calc(100%-80px)]";
const label = "text-[11px] font-bold tracking-[.18em] text-[#c0c0c0]";
const heading =
  "text-[clamp(36px,4vw,64px)] leading-[1.05] font-medium tracking-[-.055em]";
const button =
  "inline-flex min-h-11 items-center justify-center gap-6 rounded-full px-[19px] text-sm font-semibold whitespace-nowrap transition-[background,color,transform] duration-200 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none";
const lightButton = `${button} bg-[#f1f1f1] text-[#0a0a0a] hover:bg-[#e6e6e6]`;
const darkButton = `${button} bg-[#111] text-[#f2f2f0] hover:bg-[#2b2a28]`;
const hairline = "border-[#3e3e3e]";

const thesis =
  "You can prepare the songs and readings. You can't predict every verse that comes up. Kairo helps you find it, check it, and put it on screen.";

const steps = [
  {
    number: "01",
    title: "Prepare the service",
    body: "Put the songs, readings, notes, slides and media for Sunday in one service. Arrange the song sections the way your team plans to sing them.",
  },
  {
    number: "02",
    title: "Run your screens",
    body: "Choose what goes live and keep the next slide in view. Kairo can send it to a projector, TV or NDI feed, with a background, message or logo when you need one.",
  },
  {
    number: "03",
    title: "Follow the sermon",
    body: "If an unplanned verse comes up, Kairo can suggest a passage from the live audio. Check the text and put it on screen when you're ready.",
  },
  {
    number: "04",
    title: "Pick up after the service",
    body: "Use the transcript to make a sermon recap you can share. Kairo also keeps a record of the songs you showed for CCLI reporting.",
  },
];

const screens = [
  {
    title: "In the room",
    tag: "Projector · TV",
    body: "Show the congregation lyrics, Scripture, slides and media.",
  },
  {
    title: "On the stage",
    tag: "Confidence monitor",
    body: "Show the current and next slide, the clock, a countdown and messages for the stage.",
  },
  {
    title: "In the lobby",
    tag: "Its own playlist",
    body: "Play images and videos in the foyer without changing what is live in the room.",
  },
  {
    title: "On the stream",
    tag: "Up to four NDI feeds",
    body: "Put a lower third on the stream while the room sees a full-screen slide.",
  },
];

const features = [
  {
    title: "Lyrics in two languages",
    body: "Add a translated line below the lyric and give it a color of its own.",
  },
  {
    title: "Bible translations",
    body: "KJV, WEB and ASV are included. Use your API.Bible key for licensed translations.",
  },
  {
    title: "PowerPoint and PDF",
    body: "Bring in a slide deck and move through it with a clicker.",
  },
  {
    title: "Backgrounds",
    body: "Keep an image or video loop running as the words change.",
  },
  {
    title: "Messages and logos",
    body: "Show an announcement or logo without changing the live slide.",
  },
  {
    title: "Live video",
    body: "Put a camera or capture card on screen, with its audio.",
  },
  {
    title: "Stage countdown",
    body: "Keep a timer and stage-only messages where the speaker can see them.",
  },
  {
    title: "Song records",
    body: "See which songs were shown during a service when it is time to report to CCLI.",
  },
  {
    title: "Offline essentials",
    body: "Keep presenting local slides and media and looking up built-in Bibles without internet.",
  },
];

const questions = [
  {
    question: "Do I need ProPresenter to use Kairo?",
    answer:
      "No. Kairo can run the screens connected to your computer. If your team uses ProPresenter, you can connect it too.",
  },
  {
    question: "Does somebody still need to run the booth?",
    answer:
      "Yes. Kairo can suggest a verse, but someone in the booth can check it before it goes live. Automatic output is there if your team chooses to use it.",
  },
  {
    question:
      "What if the pastor paraphrases instead of reading the reference?",
    answer:
      "It can suggest a passage from the words being spoken, even without a book and chapter. Check the suggestion before sending it live.",
  },
  {
    question: "Which Bible translations can we use?",
    answer:
      "KJV, WEB and ASV are included and work offline. For licensed translations such as NIV and NLT, your church needs access through API.Bible.",
  },
  {
    question: "Does it need the internet?",
    answer:
      "Kairo can run screens and use local media and built-in Bibles without internet. Live transcription uses Deepgram, so that part needs a connection.",
  },
];

function Thesis(): React.ReactElement {
  const total = thesis.replace(/ /g, "").length;
  let letter = 0;
  return (
    <p className="landing-thesis-text mt-7 max-w-[1180px] text-[clamp(34px,4.4vw,72px)] leading-[1.08] font-medium tracking-[-.05em]">
      <span className="sr-only">{thesis}</span>
      <span aria-hidden="true">
        {thesis.split(" ").map((word, w) => (
          <Fragment key={w}>
            {w > 0 && " "}
            <span className="whitespace-nowrap">
              {[...word].map((char, c) => {
                const at = letter++ / total;
                return (
                  <span
                    key={c}
                    style={{ "--at": at.toFixed(4) } as React.CSSProperties}
                  >
                    {char}
                  </span>
                );
              })}
            </span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}

const appLabel =
  "mb-3.5 text-[10px] font-bold uppercase tracking-[.18em] text-[#787878]";

function OperatorView(): React.ReactElement {
  return (
    <figure
      className="m-0 border border-[#242424] bg-[#0d0d0d] text-[13px] text-[#e9e9e9] shadow-[0_40px_90px_-30px_#16161666]"
      aria-label="The Kairo operator view during a sermon"
    >
      <div className="flex h-[38px] items-center gap-4 border-b border-[#252525] px-3.5 text-xs text-[#949494]">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2.5 rounded-full bg-[#2f2f2f]" />
          <i className="size-2.5 rounded-full bg-[#2f2f2f]" />
          <i className="size-2.5 rounded-full bg-[#2f2f2f]" />
        </span>
        <span>Kairo · Sunday Service</span>
        <span className="ml-auto flex items-center gap-[7px] text-[#cdcdcd]">
          <i
            className="size-1.5 rounded-full bg-[#b5b5b5] shadow-[0_0_8px_#b5b5b5]"
            aria-hidden="true"
          />
          Listening
        </span>
      </div>
      <div className="grid min-h-[430px] grid-cols-1 min-[701px]:grid-cols-[1fr_1.5fr] min-[901px]:grid-cols-[1fr_1.7fr_1fr]">
        <section className="hidden border-r border-[#222] p-[18px] min-[701px]:block">
          <h4 className={appLabel}>Transcript</h4>
          <p className="mb-3 leading-[1.6] text-[#a9a9a9]">
            …and that is the heart of it. Because God so loved the world that he
            gave his only son,
          </p>
          <p className="leading-[1.6] text-[#a9a9a9]">
            <mark className="bg-[#323232] px-[3px] py-px text-[#ebebeb]">
              whoever believes in him
            </mark>{" "}
            should not perish. Turn with me to the letter to the Romans…
          </p>
        </section>
        <section className="p-[18px] min-[901px]:border-r min-[901px]:border-[#222]">
          <h4 className={appLabel}>Program</h4>
          <div className="flex aspect-video flex-col justify-end border border-[#313131] bg-[radial-gradient(ellipse_at_30%_20%,#292929,#090909_70%)] px-[8%] py-[7%]">
            <p className="text-[clamp(12px,1.25vw,18px)] leading-[1.4] font-semibold tracking-[-.01em] text-[#f5f5f5]">
              For God so loved the world, that He gave His only begotten Son,
              that whoever believes in Him should not perish but have
              everlasting life.
            </p>
            <small className="mt-2.5 text-[10px] tracking-[.14em] text-[#cdcdcd]">
              John 3:16 · NKJV
            </small>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {["Projector", "Stage", "Stream · NDI"].map((item) => (
              <span
                className="border border-[#313131] px-[9px] py-[5px] text-[11px] text-[#a2a2a2]"
                key={item}
              >
                {item}
              </span>
            ))}
          </div>
        </section>
        <section className="grid grid-cols-1 gap-2.5 border-t border-[#222] p-[18px] min-[701px]:col-span-2 min-[701px]:grid-cols-3 min-[901px]:col-span-1 min-[901px]:block min-[901px]:border-t-0">
          <h4
            className={`${appLabel} min-[701px]:col-span-3 min-[901px]:col-span-1`}
          >
            Detected
          </h4>
          <div className="relative border border-[#656565] bg-[#161616] px-3 py-[11px] min-[901px]:mb-2.5">
            <div className="flex justify-between gap-2.5">
              <b className="font-semibold text-[#f0f0f0]">John 3:16</b>
              <span className="text-[11px] text-[#cdcdcd]">Suggested</span>
            </div>
            <p className="mt-[5px] text-[11px] text-[#878787]">
              Possible match from the sermon
            </p>
            <em className="mt-2.5 inline-block bg-[#ededed] px-3 py-[5px] text-xs font-semibold not-italic text-[#0d0d0d]">
              Send
            </em>
          </div>
          {[
            ["Romans 5:8", "Up next"],
            ["Ephesians 2:8–9", "Queued"],
          ].map(([reference, state]) => (
            <div
              className="border border-[#282828] px-3 py-[11px] min-[901px]:mb-2.5"
              key={reference}
            >
              <div className="flex justify-between gap-2.5">
                <b className="font-semibold text-[#f0f0f0]">{reference}</b>
                <span className="text-[11px] text-[#878787]">{state}</span>
              </div>
              <p className="mt-[5px] text-[11px] text-[#878787]">
                From sermon notes
              </p>
            </div>
          ))}
        </section>
      </div>
      <figcaption className="border-t border-[#222] px-[18px] py-3.5 text-xs text-[#7e7e7e]">
        A sample of the transcript, live slide and suggested passages.
      </figcaption>
    </figure>
  );
}

export default function HomePage(): React.ReactElement {
  return (
    <div
      className="landing min-h-screen bg-[#060606] font-[var(--font-manrope)] text-[#f3f3f3]"
      id="top"
    >
      <a
        className="absolute -top-20 left-6 z-[100] bg-white px-[18px] py-3 text-[#111] focus:top-3"
        href="#main"
      >
        Skip to content
      </a>
      <header className="absolute inset-x-0 top-0 z-5 flex h-[72px] items-center gap-5 px-6 min-[701px]:h-[88px] min-[701px]:gap-12 min-[701px]:px-10">
        <Wordmark href="#top" />
        <nav
          className="m-auto hidden gap-[34px] min-[701px]:flex"
          aria-label="Main navigation"
        >
          {[
            ["Product", "#product"],
            ["How it works", "#workflow"],
            ["Screens", "#screens"],
            ["Questions", "#questions"],
          ].map(([text, href]) => (
            <a
              className="text-sm font-medium text-[#e8e8e8] hover:underline hover:underline-offset-[5px]"
              href={href}
              key={href}
            >
              {text}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-6 min-[701px]:ml-0">
          <Link
            className="hidden text-sm font-medium text-[#e8e8e8] hover:underline hover:underline-offset-[5px] min-[701px]:block"
            href="/login"
          >
            Sign in
          </Link>
          <Link
            className={`${lightButton} gap-[9px] px-3.5 text-xs min-[701px]:gap-6 min-[701px]:px-[19px] min-[701px]:text-sm`}
            href="/signup"
          >
            Get early access <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <main id="main">
        <section
          className="relative flex h-auto min-h-[760px] flex-col justify-end overflow-hidden border-b border-[#272727] bg-[radial-gradient(ellipse_at_top_right,#1b1b1b_0%,#060606_60%)] min-[701px]:h-[max(680px,100svh)] min-[701px]:min-h-[min(840px,100svh)]"
          aria-labelledby="hero-title"
        >
          <div className="relative z-2 mb-[105px] w-auto px-5 min-[701px]:mb-[clamp(56px,9vh,100px)] min-[701px]:px-10">
            <p className={label}>PRESENTATION SOFTWARE FOR THE CHURCH</p>
            <h1
              className="my-6 text-[clamp(43px,11vw,70px)] leading-[.98] font-medium tracking-[-.065em] min-[701px]:text-[clamp(52px,7.4vw,128px)]"
              id="hero-title"
            >
              Run the service. <br className="hidden min-[701px]:block" />
              Keep up with the sermon.
            </h1>
            <p className="max-w-[510px] text-[clamp(17px,1.4vw,20px)] leading-[1.55] text-[#bdbdbd]">
              Put lyrics, Scripture, slides and media on your own screens. When
              a verse comes up that you didn't prepare, Kairo helps you find it.
            </p>
            <div className="mt-[33px] flex flex-wrap items-center gap-[30px]">
              <Link className={lightButton} href="/signup">
                Get early access <span aria-hidden="true">↗</span>
              </Link>
              <a
                className="inline-flex gap-[18px] text-sm font-semibold text-[#e6e6e6] hover:underline hover:underline-offset-[5px]"
                href="#product"
              >
                Take a look <span aria-hidden="true">↓</span>
              </a>
              <span className="basis-full text-xs tracking-[.02em] text-[#7d7d7d] min-[701px]:basis-auto">
                Runs on its own · ProPresenter optional
              </span>
            </div>
          </div>
        </section>

        <section className="landing-thesis" aria-label="Why Kairo">
          <div
            className={`landing-thesis-pin ${container} py-[80px] min-[701px]:py-[140px]`}
          >
            <p className={label}>WHY KAIRO</p>
            <Thesis />
          </div>
        </section>

        <section
          className="bg-[#e8e7e3] py-[80px] text-[#111] min-[701px]:py-[130px]"
          id="product"
          aria-labelledby="product-title"
        >
          <div className={container}>
            <div className="mb-10 grid items-end gap-x-[70px] gap-y-6 min-[901px]:mb-16 min-[901px]:grid-cols-[1fr_1.2fr]">
              <p className={`${label} text-[#6d6c68] min-[901px]:col-span-2`}>
                THE OPERATOR VIEW
              </p>
              <h2 className={heading} id="product-title" data-reveal="">
                See what's live.
                <br />
                See what's next.
              </h2>
              <p
                className="max-w-[520px] text-lg leading-[1.55] text-[#4f4e4b]"
                data-reveal=""
              >
                The transcript, the live slide and suggested passages sit side
                by side, so you can keep an eye on the sermon and the screens.
              </p>
            </div>
            <OperatorView />
          </div>
        </section>

        <section
          className={`${container} grid gap-[30px] py-[75px] min-[701px]:py-[150px] min-[901px]:grid-cols-[1fr_1.2fr] min-[901px]:gap-[70px]`}
          id="workflow"
        >
          <div className="self-start min-[701px]:sticky min-[701px]:top-[54px]">
            <p className={label}>HOW KAIRO WORKS</p>
            <h2 className={`${heading} mt-[26px] max-w-[500px]`} data-reveal="">
              Before, during and after the service.
            </h2>
          </div>
          <div className="mt-[42px] min-[701px]:mt-0">
            {steps.map((item) => (
              <article
                className={`grid grid-cols-[55px_1fr] gap-x-6 border-t py-[30px] last:border-b ${hairline}`}
                data-reveal=""
                key={item.number}
              >
                <span className="row-span-2 pt-[5px] text-xs text-[#a7a7a7]">
                  {item.number}
                </span>
                <h3 className="text-[25px] leading-[1.2] font-medium tracking-[-.035em]">
                  {item.title}
                </h3>
                <p className="mt-2.5 max-w-[500px] text-base leading-[1.6] text-[#b2b2b2]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="bg-[#e8e7e3] text-[#111]"
          id="screens"
          aria-labelledby="screens-title"
        >
          <div
            className={`${container} grid gap-[30px] py-[75px] min-[701px]:py-[140px] min-[901px]:grid-cols-[1fr_1.2fr] min-[901px]:gap-[70px]`}
          >
            <div className="self-start min-[701px]:sticky min-[701px]:top-[54px]">
              <p className={`${label} text-[#6d6c68]`}>SCREENS</p>
              <h2
                className={`${heading} mt-[26px] max-w-[560px]`}
                id="screens-title"
                data-reveal=""
              >
                Set up each screen for where it is.
              </h2>
            </div>
            <div className="mt-[42px] border-t border-[#cfcec9] min-[701px]:mt-0">
              {screens.map((screen) => (
                <article
                  className="grid gap-2.5 border-b border-[#cfcec9] py-7 min-[701px]:grid-cols-[minmax(130px,.65fr)_1fr] min-[701px]:gap-7"
                  data-reveal=""
                  key={screen.title}
                >
                  <div>
                    <h3 className="text-xl font-medium tracking-[-.025em]">
                      {screen.title}
                    </h3>
                    <span className="mt-2 block text-[11px] uppercase tracking-[.14em] text-[#7a7975]">
                      {screen.tag}
                    </span>
                  </div>
                  <p className="text-[15px] leading-[1.6] text-[#4f4e4b]">
                    {screen.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className={`border-t ${hairline} py-[80px] min-[701px]:py-[130px]`}
          aria-labelledby="features-title"
        >
          <div className={container}>
            <p className={label}>MORE TO WORK WITH</p>
            <h2
              className={`${heading} my-[26px] mb-14 max-w-[760px]`}
              id="features-title"
              data-reveal=""
            >
              The details your team needs.
            </h2>
            <div
              className={`grid grid-cols-1 border-t border-l min-[701px]:grid-cols-2 min-[901px]:grid-cols-3 ${hairline}`}
            >
              {features.map((feature) => (
                <article
                  className={`border-r border-b px-7 pt-7 pb-8 ${hairline}`}
                  key={feature.title}
                >
                  <h3 className="text-lg font-medium tracking-[-.02em]">
                    {feature.title}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-[1.55] text-[#b2b2b2]">
                    {feature.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#e8e7e3] text-[#111]">
          <div className={`${container} py-20 min-[701px]:py-[125px]`}>
            <p className={`${label} text-[#6d6c68]`}>WORKS WITH YOUR SETUP</p>
            <h2 className={`${heading} my-6 max-w-[780px]`} data-reveal="">
              Use Kairo on its own. Connect ProPresenter if you need it.
            </h2>
            <p
              className="max-w-[630px] text-[19px] leading-[1.5] text-[#4f4e4b]"
              data-reveal=""
            >
              Kairo can run your screens without ProPresenter. If it's already
              part of your setup, you can send to it as well. NDI output is
              available for a switcher or stream.
            </p>
            <div className="mt-10 flex flex-wrap gap-3" data-reveal="">
              {["Kairo screens", "NDI feeds", "ProPresenter · optional"].map(
                (item) => (
                  <span
                    className="rounded-full border border-[#b9b8b3] px-[18px] py-3 text-[13px] text-[#2b2a28]"
                    key={item}
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>
        </section>

        <section
          className={`${container} grid gap-[30px] py-[90px] min-[701px]:py-[140px] min-[901px]:grid-cols-[1fr_1.2fr] min-[901px]:gap-[70px]`}
          id="questions"
        >
          <div>
            <p className={label}>QUESTIONS</p>
            <h2 className={`${heading} mt-6`}>Good to know.</h2>
          </div>
          <div className={`mt-[42px] border-t min-[701px]:mt-0 ${hairline}`}>
            {questions.map(({ question, answer }) => (
              <details className={`group border-b ${hairline}`} key={question}>
                <summary className="flex cursor-pointer list-none justify-between gap-5 py-[25px] text-[19px] [&::-webkit-details-marker]:hidden">
                  {question}
                  <span
                    className="text-2xl leading-none text-[#aeaeae] transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mb-[25px] max-w-[600px] text-base leading-[1.6] text-[#bebebe]">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="bg-[#e8e7e3] text-[#111]">
          <div
            className={`${container} py-[85px] min-[701px]:py-[100px] min-[701px]:pb-[120px]`}
            id="get"
          >
            <p className={`${label} text-[#6d6c68]`}>GET STARTED</p>
            <h2 className={`${heading} my-[22px] max-w-[700px]`} data-reveal="">
              Want to try Kairo at your church?
            </h2>
            <p className="mb-[30px] max-w-[530px] text-lg leading-[1.5] text-[#4f4e4b]">
              Kairo is still in development. Create an account now if your
              church would like to try it.
            </p>
            <Link className={darkButton} href="/signup">
              Get early access <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="overflow-hidden border-t border-[#3e3e3e] bg-[#040404] pt-[60px] min-[701px]:pt-[70px]">
        <div
          className={`${container} grid min-h-[240px] grid-cols-2 gap-x-5 gap-y-[42px] pb-[65px] min-[701px]:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))] min-[701px]:gap-[60px] min-[701px]:pb-0`}
        >
          <div className="col-span-2 min-[701px]:col-span-1">
            <Wordmark href="#top" />
            <p className="mt-[22px] max-w-[28ch] text-[15px] leading-[1.55] text-[#a1a1a1]">
              For the people who put Sunday on screen.
            </p>
          </div>
          <nav
            className="flex flex-col items-start gap-[17px]"
            aria-label="Footer navigation"
          >
            {[
              ["Product", "#product"],
              ["How it works", "#workflow"],
              ["Screens", "#screens"],
              ["Questions", "#questions"],
            ].map(([text, href]) => (
              <a
                className="text-sm text-[#d8d8d8] hover:underline hover:underline-offset-[5px]"
                href={href}
                key={href}
              >
                {text}
              </a>
            ))}
          </nav>
          <div className="flex flex-col items-start gap-[17px]">
            <Link
              className="text-sm text-[#d8d8d8] hover:underline hover:underline-offset-[5px]"
              href="/login"
            >
              Sign in
            </Link>
            <Link
              className="text-sm text-[#f4f4f4] hover:underline hover:underline-offset-[5px]"
              href="/signup"
            >
              Get early access <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
        <div
          className={`${container} grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[#292929] py-[22px] text-[11px] tracking-[.16em] text-[#959595] min-[701px]:grid-cols-3 min-[701px]:gap-6`}
        >
          <span>BUILT FOR THE BOOTH</span>
          <small className="col-span-2 row-start-2 text-[11px] tracking-[.16em] min-[701px]:col-span-1 min-[701px]:row-start-auto min-[701px]:text-center">
            © {new Date().getFullYear()} Kairo
          </small>
          <a
            className="justify-self-end text-[#adadad] hover:underline hover:underline-offset-[5px]"
            href="#top"
          >
            Back to top ↑
          </a>
        </div>
        <div
          className="landing-footer-wordmark w-full select-none whitespace-nowrap px-[1.4vw] pt-[22px] pb-[.08em] text-center text-[15vw] leading-[.9] font-bold tracking-[-.09em] text-[#181818] min-[701px]:text-[clamp(2.5rem,18vw,16rem)]"
          aria-hidden="true"
        >
          KAIRO
        </div>
      </footer>
    </div>
  );
}
