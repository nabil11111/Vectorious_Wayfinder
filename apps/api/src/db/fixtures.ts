// Demo records that the booklet does not supply. Everything here is ours, labelled as a fixture, and kept small.

// The fixed product list, same numbers as docs/product-list.md.
export const PRODUCTS = [
  { id: 'fresh-chilled-carton', brand: 'Fresh', name: 'Chilled carton', unit: 'carton', kgPerUnit: '6.9', m3PerUnit: '0.037', temp: 'chilled', needsTailLift: false, keepUpright: false },
  { id: 'fresh-dry-carton', brand: 'Fresh', name: 'Dry carton', unit: 'carton', kgPerUnit: '6.9', m3PerUnit: '0.037', temp: 'dry', needsTailLift: false, keepUpright: false },
  { id: 'style-folded', brand: 'Style', name: 'Folded clothing', unit: 'box', kgPerUnit: '12', m3PerUnit: '0.2', temp: 'dry', needsTailLift: false, keepUpright: false },
  { id: 'style-hanging', brand: 'Style', name: 'Hanging garments', unit: 'rail box', kgPerUnit: '14', m3PerUnit: '0.3', temp: 'dry', needsTailLift: false, keepUpright: true },
  { id: 'style-shoes', brand: 'Style', name: 'Shoes', unit: 'carton', kgPerUnit: '18', m3PerUnit: '0.22', temp: 'dry', needsTailLift: false, keepUpright: false },
  { id: 'style-bags', brand: 'Style', name: 'Bags and accessories', unit: 'carton', kgPerUnit: '9', m3PerUnit: '0.14', temp: 'dry', needsTailLift: false, keepUpright: false },
  { id: 'tech-tv', brand: 'Tech', name: 'Televisions', unit: 'pallet of 8', kgPerUnit: '170', m3PerUnit: '0.6', temp: 'dry', needsTailLift: false, keepUpright: false },
  { id: 'tech-washer', brand: 'Tech', name: 'Washing machines', unit: 'crate of 3', kgPerUnit: '210', m3PerUnit: '0.7', temp: 'dry', needsTailLift: true, keepUpright: false },
  { id: 'tech-fridge', brand: 'Tech', name: 'Refrigerators', unit: 'crate of 2', kgPerUnit: '250', m3PerUnit: '0.85', temp: 'dry', needsTailLift: true, keepUpright: false },
  { id: 'tech-small', brand: 'Tech', name: 'Small appliances', unit: 'pallet', kgPerUnit: '190', m3PerUnit: '0.62', temp: 'dry', needsTailLift: false, keepUpright: false },
] as const;

// One account per role, named after the personas in the design. The outlet and depot are picked in seed.ts.
export const DEMO_USERS = [
  { username: 'nadeesha', displayName: 'Nadeesha', role: 'store_manager', depot: 'Peliyagoda' },
  { username: 'ruwan', displayName: 'Ruwan', role: 'dispatcher', depot: 'Peliyagoda' },
  { username: 'kasun', displayName: 'Kasun', role: 'loader', depot: 'Peliyagoda' },
  { username: 'prasanna', displayName: 'Prasanna', role: 'driver', depot: 'Kandy' },
  { username: 'admin', displayName: 'Admin', role: 'admin', depot: null },
] as const;
