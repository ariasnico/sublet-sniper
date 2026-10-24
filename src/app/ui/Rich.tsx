import type { ReactNode } from "react";

/** Inline: **bold** and $prices get emphasis. */
function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\$\d[\d,]*(?:\/mo|\/mes)?)/g).map((p, i) =>
    p.startsWith("**") ? <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>
    : /^\$\d/.test(p) ? <b key={`${key}-${i}`} className="money">{p}</b>
    : p);
}

const ICON = new RegExp("^(\\p{Extended_Pictographic}\\uFE0F?)\\s*(.+)$", "u");

/** Light formatting for agent replies: paragraphs, numbered and bulleted lists. */
export function Rich({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `li${out.length}-${i}`)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const num = line.match(/^#?\d+[.)]\s+(.*)$/) ?? line.match(/^#\d+:?\s+(.*)$/);
    const bul = line.match(/^[•\-*]\s+(.*)$/);
    if (num || bul) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((num ?? bul)![1]);
      continue;
    }
    flush();
    if (!line) continue;
    // A leading emoji (🚩, 💬, 📅…) is an icon: give it its own slot so the text after it lines up.
    const ico = line.match(ICON);
    out.push(ico
      ? <p key={out.length} className="rich-ico"><span aria-hidden="true">{ico[1]}</span><span>{inline(ico[2], `p${out.length}`)}</span></p>
      : <p key={out.length}>{inline(line, `p${out.length}`)}</p>);
  }
  flush();
  return <div className="rich">{out}</div>;
}
