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

// One account per role, named after the personas in the design, plus a Peliyagoda driver so the shop, dispatcher,
// loader and a driver all belong to the same depot. A store manager belongs to one shop: Nadeesha's is the Fresh
// shop of the design, and the Style and Tech brands have a manager each so all three order forms can be seen
// (D-27).
export const DEMO_USERS = [
  { username: 'nadeesha', displayName: 'Nadeesha', role: 'store_manager', depot: 'Peliyagoda', outlet: 'OUT001' },
  { username: 'ishara', displayName: 'Ishara', role: 'store_manager', depot: 'Peliyagoda', outlet: 'OUT017' },
  { username: 'tharindu', displayName: 'Tharindu', role: 'store_manager', depot: 'Peliyagoda', outlet: 'OUT064' },
  { username: 'ruwan', displayName: 'Ruwan', role: 'dispatcher', depot: 'Peliyagoda', outlet: null },
  { username: 'kasun', displayName: 'Kasun', role: 'loader', depot: 'Peliyagoda', outlet: null },
  { username: 'dilshan', displayName: 'Dilshan', role: 'driver', depot: 'Peliyagoda', outlet: null },
  { username: 'prasanna', displayName: 'Prasanna', role: 'driver', depot: 'Kandy', outlet: null },
  { username: 'admin', displayName: 'Admin', role: 'admin', depot: null, outlet: null },
  // A driver for each of Peliyagoda's 35 working vehicles, so every trip on the plan board can name one as the
  // design's frames do (spec 010, D-31). Dilshan, above, is the one the walkthrough follows.
  ...['Chaminda', 'Lasantha', 'Priyantha', 'Sanjeewa', 'Mahesh', 'Nuwan', 'Saman', 'Pradeep', 'Asanka', 'Chathura', 'Kamal',
    'Sunil', 'Nimal', 'Janaka', 'Roshan', 'Suresh', 'Anura', 'Buddhika', 'Dinesh', 'Gayan', 'Harsha', 'Isuru', 'Jagath',
    'Kelum', 'Lahiru', 'Madushan', 'Nalin', 'Pasan', 'Rangana', 'Sampath', 'Thilak', 'Udara', 'Viraj', 'Wasantha',
  ].map((name) => ({ username: name.toLowerCase(), displayName: name, role: 'driver', depot: 'Peliyagoda', outlet: null }) as const),
] as const;
