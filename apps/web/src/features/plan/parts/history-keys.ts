// The board's history keys and Start over's question (spec 027).

// A key press as the history reads it: the key, its modifiers, and where the focus is, as the element's tag name, or
// "EDITABLE" for an element whose text can be edited.
export interface HistoryPress { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: string }

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'EDITABLE']);

// Ctrl+Z or Cmd+Z undoes, and Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y redoes, never while the focus is in a text box,
// where the keys are the box's own.
export function historyKey(press: HistoryPress): 'undo' | 'redo' | null {
  if (TYPING.has(press.target) || !(press.ctrlKey || press.metaKey)) return null;
  const key = press.key.toLowerCase();
  if (key === 'z') return press.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && press.ctrlKey && !press.shiftKey) return 'redo';
  return null;
}

// What the focus is in, for historyKey.
export const pressOf = (event: KeyboardEvent): HistoryPress => {
  const element = event.target instanceof HTMLElement ? event.target : null;
  return { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, target: element?.isContentEditable ? 'EDITABLE' : element?.tagName ?? 'BODY' };
};

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
// "Take every trip and deferral off Thursday's plan? …", for the plan's day.
export const START_OVER_LINE = (date: string) =>
  `Take every trip and deferral off ${WEEKDAY.format(new Date(`${date}T00:00:00Z`))}'s plan? Every order goes back to Unplanned. You can undo this.`;
