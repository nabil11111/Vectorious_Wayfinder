// Where Decide, Open next and the dashboard's links move the focus on Live day (spec 016, rule 5): a problem's card in
// Needs you, a trip's row, and the button that opened a trip's details, which Close hands the focus back to.

export const issueAnchor = (issueId: string) => `issue-${issueId}`;
export const tripAnchor = (tripId: string) => `trip-${tripId}`;

// Brings a problem's card into view and focuses it. false when the card is not on the page.
export function focusIssue(issueId: string) {
  const card = document.getElementById(issueAnchor(issueId));
  if (!card) return false;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.focus({ preventScroll: true });
  return true;
}

export function showTrip(tripId: string) {
  document.getElementById(tripAnchor(tripId))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// A row is drawn twice, as a table row and as a phone card, so the button on show takes the focus.
export function focusOpener(tripId: string) {
  const buttons = [...document.querySelectorAll<HTMLElement>(`[data-opener="${tripId}"]`)];
  buttons.find((button) => button.offsetParent !== null)?.focus();
}
