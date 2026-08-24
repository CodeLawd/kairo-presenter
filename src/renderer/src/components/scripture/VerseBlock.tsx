import type { ScriptureResult } from "@shared/ipc";

export function VerseBlock({
  verse,
  showNumbers,
}: {
  verse: ScriptureResult["verses"][number];
  showNumbers: boolean;
}): React.ReactElement {
  return (
    <p className="scripture-text text-[15px] text-slate-200 leading-relaxed font-serif">
      {showNumbers && (
        <sup
          className="text-teal-400 font-semibold mr-1.5 text-[10px] font-sans vertical-align-super"
          aria-hidden="true"
        >
          {verse.verse}
        </sup>
      )}
      {verse.text}
    </p>
  );
}
