// The booklet's two depots (outlets.csv, vehicles.csv), as the frames' switches list them.
export const DEPOTS = ['Peliyagoda', 'Kandy'];

// What a depot the dispatcher does not plan says when pointed at or pressed: they plan their own only (D-32).
export const youPlan = (depot: string) => `You plan ${depot}`;
