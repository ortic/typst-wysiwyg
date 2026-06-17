// Templates are just saved Docs (logic layer + starter content). This is the
// payoff of owning a structured model: the template library is trivial data.

import type { Doc } from './model';
import { uid } from './model';

export type TemplateIcon = 'file' | 'mail' | 'chart' | 'receipt' | 'notes';

export interface Template {
  id: string;
  label: string;
  icon: TemplateIcon; // resolved to an inline SVG in the picker
  description: string;
  keywords: string; // extra search terms
  make: () => Doc;
}

function blank(): Doc {
  return {
    style: {
      page: { paper: 'a4', marginCm: 2.5 },
      text: { font: '', sizePt: 11 },
      par: { leadingEm: 0.65, justify: true },
    },
    lets: [],
    content: [
      { id: uid(), type: 'heading', level: 1, text: 'Untitled document' },
      { id: uid(), type: 'paragraph', text: 'Start writing here.' },
    ],
  };
}

function letter(): Doc {
  return {
    style: {
      page: { paper: 'us-letter', marginCm: 3 },
      text: { font: '', sizePt: 11 },
      par: { leadingEm: 0.7, justify: false },
    },
    lets: [{ id: uid(), name: 'sender', kind: 'value', code: '"Ortic AG, Zurich"' }],
    content: [
      { id: uid(), type: 'raw', code: '#align(right)[#sender]' },
      { id: uid(), type: 'paragraph', text: 'Dear Sir or Madam,' },
      {
        id: uid(),
        type: 'paragraph',
        text: 'Thank you for your interest. I am writing to follow up on our recent conversation.',
      },
      { id: uid(), type: 'paragraph', text: 'Kind regards,' },
      { id: uid(), type: 'raw', code: '#sender' },
    ],
  };
}

function report(): Doc {
  return {
    style: {
      page: { paper: 'a4', marginCm: 2.5 },
      text: { font: '', sizePt: 11 },
      par: { leadingEm: 0.65, justify: true },
    },
    lets: [],
    content: [
      { id: uid(), type: 'heading', level: 1, text: 'Quarterly Report' },
      { id: uid(), type: 'paragraph', text: 'This report summarizes the results for the quarter.' },
      { id: uid(), type: 'heading', level: 2, text: 'Highlights' },
      {
        id: uid(),
        type: 'list',
        ordered: false,
        items: ['Revenue up 12%', 'Two new customers onboarded', 'Shipped the v1 release'],
      },
      {
        id: uid(),
        type: 'callout',
        text: 'Action required: review the budget before the next board meeting.',
      },
      { id: uid(), type: 'heading', level: 2, text: 'Details' },
      { id: uid(), type: 'paragraph', text: 'See the appendix for the full breakdown.' },
    ],
  };
}

function invoice(): Doc {
  return {
    style: {
      page: { paper: 'a4', marginCm: 2.5 },
      text: { font: '', sizePt: 11 },
      par: { leadingEm: 0.65, justify: false },
    },
    lets: [{ id: uid(), name: 'company', kind: 'value', code: '"Ortic AG"' }],
    content: [
      { id: uid(), type: 'raw', code: '#align(right)[#text(weight: "bold", size: 14pt)[#company]]' },
      { id: uid(), type: 'heading', level: 1, text: 'Invoice' },
      { id: uid(), type: 'paragraph', text: 'Invoice #2026-001 · Date: 2026-06-17' },
      {
        id: uid(),
        type: 'raw',
        code: '#table(\n  columns: (1fr, auto, auto),\n  [*Item*], [*Qty*], [*Price*],\n  [Consulting], [10], [\\$1,500],\n  [License], [1], [\\$500],\n)',
      },
      { id: uid(), type: 'callout', text: 'Payment due within 30 days.' },
    ],
  };
}

function meetingNotes(): Doc {
  return {
    style: {
      page: { paper: 'a4', marginCm: 2.5 },
      text: { font: '', sizePt: 11 },
      par: { leadingEm: 0.65, justify: false },
    },
    lets: [],
    content: [
      { id: uid(), type: 'heading', level: 1, text: 'Meeting Notes' },
      { id: uid(), type: 'paragraph', text: 'Date: 2026-06-17 · Attendees: …' },
      { id: uid(), type: 'heading', level: 2, text: 'Agenda' },
      { id: uid(), type: 'list', ordered: true, items: ['Topic one', 'Topic two'] },
      { id: uid(), type: 'heading', level: 2, text: 'Action items' },
      { id: uid(), type: 'list', ordered: false, items: ['Owner — task — due date'] },
    ],
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
