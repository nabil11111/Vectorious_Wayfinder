import { PlanInputError } from './errors';

// Finds a row by its id. An id the input does not hold is a programming mistake, not a problem with the
// plan, so it throws and names it.
export const lookup = <T extends { id: string }>(rows: T[], what: string) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (id: string): T => {
    const row = byId.get(id);
    if (!row) throw new PlanInputError(`No ${what} ${id} in the input`);
    return row;
  };
};
