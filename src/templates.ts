// Templates = a saved logic layer + a ProseMirror content document (as JSON).
// Owning a structured model makes the template library trivial data.

import type { DocLogic } from './model';
import { uid, linkShow } from './model';

export type TemplateIcon = 'file' | 'mail' | 'chart' | 'receipt' | 'notes';

export interface Template {
  id: string;
  label: string;
  icon: TemplateIcon;
  description: string;
  keywords: string;
  make: () => { logic: DocLogic; content: object };
}

// --- tiny ProseMirror-JSON builders ------------------------------------------
type J = Record<string, unknown>;
function txt(text: string, marks?: string[]): J {
  return marks?.length ? { type: 'text', text, marks: marks.map((m) => ({ type: m })) } : { type: 'text', text };
}
function p(...content: (J | string)[]): J {
  return { type: 'paragraph', content: content.map((c) => (typeof c === 'string' ? txt(c) : c)).filter(Boolean) };
}
function h(level: number, text: string): J {
  return { type: 'heading', attrs: { level }, content: [txt(text)] };
}
function li(...content: J[]): J {
  return { type: 'listItem', content };
}
function bullet(...items: string[]): J {
  return { type: 'bulletList', content: items.map((t) => li(p(t))) };
}
function ordered(...items: string[]): J {
  return { type: 'orderedList', attrs: { start: 1 }, content: items.map((t) => li(p(t))) };
}
function callout(...content: J[]): J {
  return { type: 'callout', content };
}
function raw(code: string): J {
  return { type: 'codeBlock', content: [txt(code)] };
}
function th(text: string): J {
  return { type: 'tableHeader', content: [p(text)] };
}
function td(text: string): J {
  return { type: 'tableCell', content: [p(text)] };
}
function tr(...cells: J[]): J {
  return { type: 'tableRow', content: cells };
}
function table(...rows: J[]): J {
  return { type: 'table', content: rows };
}
function doc(...content: J[]): object {
  return { type: 'doc', content };
}

function baseStyle(justify: boolean): DocLogic['style'] {
  return {
    page: { paper: 'a4', marginCm: 2.5 },
    text: { font: '', sizePt: 11 },
    par: { leadingEm: 0.65, justify },
  };
}

// --- templates ---------------------------------------------------------------
function blank() {
  return {
    logic: { style: baseStyle(true), lets: [], shows: [linkShow()] },
    content: doc(h(1, 'Untitled document'), p('Start writing here.')),
  };
}

function letter() {
  return {
    logic: {
      style: { ...baseStyle(false), page: { paper: 'us-letter' as const, marginCm: 3 } },
      lets: [{ id: uid('let'), name: 'sender', kind: 'value' as const, code: '"Ortic AG, Zurich"' }],
      shows: [linkShow()],
    },
    content: doc(
      raw('#align(right)[#sender]'),
      p('Dear Sir or Madam,'),
      p('Thank you for your interest. I am writing to follow up on our recent conversation.'),
      p('Kind regards,'),
      raw('#sender'),
    ),
  };
}

function report() {
  return {
    logic: {
      style: baseStyle(true),
      lets: [],
      shows: [
        {
          id: uid('show'),
          target: 'heading' as const,
          level: 1,
          props: { fill: '#1c7ed6', sizePt: null, weight: 'bold' as const, style: 'inherit' as const },
        },
        linkShow(),
      ],
    },
    content: doc(
      h(1, 'Quarterly Report'),
      p('This report summarizes the results for the quarter. Highlights are ', txt('strong', ['bold']), ' this period.'),
      h(2, 'Highlights'),
      bullet('Revenue up 12%', 'Two new customers onboarded', 'Shipped the v1 release'),
      callout(p('Action required: review the budget before the next board meeting.')),
      h(2, 'Details'),
      p('See the appendix for the full breakdown.'),
    ),
  };
}

function invoice() {
  return {
    logic: {
      style: baseStyle(false),
      lets: [{ id: uid('let'), name: 'company', kind: 'value' as const, code: '"Ortic AG"' }],
      shows: [linkShow()],
    },
    content: doc(
      raw('#align(right)[#text(weight: "bold", size: 14pt)[#company]]'),
      h(1, 'Invoice'),
      p('Invoice #2026-001 · Date: 2026-06-17'),
      table(
        tr(th('Item'), th('Qty'), th('Price')),
        tr(td('Consulting'), td('10'), td('$1,500')),
        tr(td('License'), td('1'), td('$500')),
      ),
      callout(p('Payment due within 30 days.')),
    ),
  };
}

function meetingNotes() {
  return {
    logic: { style: baseStyle(false), lets: [], shows: [linkShow()] },
    content: doc(
      h(1, 'Meeting Notes'),
      p('Date: 2026-06-17 · Attendees: …'),
      h(2, 'Agenda'),
      ordered('Topic one', 'Topic two'),
      h(2, 'Action items'),
      bullet('Owner — task — due date'),
    ),
  };
}

export const TEMPLATES: Template[] = [
  { id: 'blank', label: 'Blank', icon: 'file', description: 'An empty document', keywords: 'empty new start', make: blank },
  { id: 'letter', label: 'Letter', icon: 'mail', description: 'Formal letter layout', keywords: 'mail correspondence formal', make: letter },
  { id: 'report', label: 'Report', icon: 'chart', description: 'Headings, lists and a callout', keywords: 'business quarterly summary', make: report },
  { id: 'invoice', label: 'Invoice', icon: 'receipt', description: 'Billing with an items table', keywords: 'bill payment table finance', make: invoice },
  { id: 'meeting', label: 'Meeting Notes', icon: 'notes', description: 'Agenda and action items', keywords: 'minutes agenda standup', make: meetingNotes },
];

export const TEMPLATE_ICONS: Record<TemplateIcon, string> = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  chart: '<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="16" y="9" width="3" height="9"/>',
  receipt: '<path d="M6 3v18l2-1.2L10 21l2-1.2L14 21l2-1.2L18 21V3l-2 1.2L14 3l-2 1.2L10 3 8 4.2z"/><path d="M9 8h6M9 12h6"/>',
  notes: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
};
