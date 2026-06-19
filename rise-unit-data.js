/* ============================================================
   RISE Furnished Stays — shared unit data
   Used by the Unit A / Unit B / Unit D detail pages.
   The three homes are nearly identical units in one remodeled
   South Austin fourplex, so amenities + house rules are shared.
   ============================================================ */

/* ---- Amenities (shared across all three homes) ---- */
const AMENITIES = [
  { cat: "General", items: [
    "Private entrance", "Private backyard", "Free parking on-site (2 vehicles)",
    "Partially fenced parking lot", "Ceiling fan", "Central air conditioning",
    "Heating", "Hot water", "Dedicated work desks", "Room-darkening shades",
    "Smoke alarm", "Carbon monoxide alarm", "Fire extinguisher",
  ]},
  { cat: "Kitchen", items: [
    "New stainless steel appliances", "Quartz countertops", "Stove & oven",
    "Microwave", "Refrigerator & freezer", "Dishwasher", "Hot water kettle",
    "Coffee maker", "Pots, pans & cooking utensils",
    "Dishes, silverware, cups & cutlery", "Dining table", "Hand soap", "Dish soap",
  ]},
  { cat: "Bathrooms", items: [
    "Bathtub", "Hair dryer", "Shampoo", "Conditioner", "Body soap", "Hand soap",
  ]},
  { cat: "Living & laundry", items: [
    "High-speed Wi-Fi", "Smart TV", "In-unit washer", "In-unit dryer",
    "Clothing closet & hangers", "Towels", "Bed linens",
    "Self check-in · smart lock", "All utilities included",
  ]},
];

/* ---- House rules (shared) ---- */
const HOUSE_RULES = [
  { t: "<strong>Do not flush</strong> anything down the toilet except toilet paper — no flushable wipes. Guests are responsible for plumbing costs from clogs.", warn: true },
  { t: "No smoking, vaping, or drugs anywhere on the property.", warn: true },
  { t: "No parties or loud music.", warn: true },
  { t: "No unregistered pets or guests.", warn: true },
  { t: "Quiet hours are 11:00 PM – 7:00 AM." },
  { t: "Treat the unit like your own home — take care of the furniture, keep it clean, and don't move furniture around." },
  { t: "After a wash cycle, leave the washing machine door open to prevent mold." },
  { t: "Keep all doors closed to keep insects out. When entering at night, keep inside lights off and the outside light on to deter insects." },
  { t: "Please turn off the lights when not in use." },
  { t: "Place garbage in the brown bins, recycling in the blue bins, in front of the house. Make sure to place the garbage inside the bins. Otherwise, an \"extra trash sticker\" from the convenience store is required." },
];

/* ---- Shared overview copy (used by B & D, lightly adapted) ---- */
const OVERVIEW_BASE = [
  "Enjoy a comfortable stay in this 2-bedroom, 1.5-bath home, thoughtfully equipped for working professionals and extended stays. Fully furnished with high-speed Wi-Fi, dedicated workspaces, a Smart TV, in-unit laundry, and all utilities included, you'll have everything you need to live and work comfortably from day one.",
  "The open-concept floor plan on the first floor features a fully equipped kitchen with new stainless steel appliances and quartz countertops, a living area, dining space, half bath, and a private backyard. Upstairs, you'll find two comfortable bedrooms and a full bathroom, offering privacy and separation between living and working areas.",
  "Conveniently located between I-35 and South Lamar, the home provides easy access to downtown Austin, major employers, hospitals, and some of the city's best restaurants, coffee shops, and entertainment. Whether you're relocating, working on a temporary assignment, traveling for healthcare, or simply seeking a longer stay in Austin, this centrally located home offers the comfort and flexibility of a true home away from home.",
  "Guests enjoy exclusive access to the entire property, including the backyard, as well as complimentary on-site parking for two vehicles.",
];

const HIGHLIGHTS_BASE = [
  { ic: "🔑", t: "Seamless self check-in" },
  { ic: "📶", t: "Fast Wi-Fi & work desks" },
  { ic: "🅿️", t: "Free on-site parking" },
  { ic: "🧺", t: "In-unit laundry" },
];

const SPECS_BASE = ["4 guests", "2 bedrooms", "2 queen beds", "1 sofa bed", "1.5 bathrooms"];

const PRECAUT_BASE = [
  { ic: "🪜", t: "Guests must climb stairs to the bedrooms" },
  { ic: "📷", t: "Exterior security camera on site" },
  { ic: "🧒", t: "Not suitable for children ages 0–9" },
  { ic: "🏘️", t: "This is a unit in a fourplex — two of the walls are shared with neighboring units." },
];

const ADDR_BASE = "5907 Cougar Drive, Austin, TX 78745";

/* ---- Unit A ---- */
const UNIT_A = {
  code: "Unit A", kicker: "Private Townhouse",
  title: "Cozy Home in South Austin · Fully Furnished 2BR Near South Lamar",
  rating: "4.97", reviews: 29, petsOk: false, addr: ADDR_BASE,
  specs: SPECS_BASE, overview: OVERVIEW_BASE, highlights: HIGHLIGHTS_BASE,
  precautions: PRECAUT_BASE,
  gallery: [
    { src: "assets/unitA/01-living-open.jpg", cap: "Living room" },
    { src: "assets/unitA/02-living-sofabed-window.jpg", cap: "Living room · sofa bed" },
    { src: "assets/unitA/03-living-sofabed.jpg", cap: "Living room · sofa bed" },
    { src: "assets/unitA/04-kitchen-bar.jpg", cap: "Kitchen & breakfast bar" },
    { src: "assets/unitA/05-kitchen-range.jpg", cap: "Kitchen" },
    { src: "assets/unitA/06-kitchen-galley.jpg", cap: "Kitchen" },
    { src: "assets/unitA/07-dining.jpg", cap: "Dining area" },
    { src: "assets/unitA/08-entryway.jpg", cap: "Entryway · smart lock" },
    { src: "assets/unitA/09-bedroom1.jpg", cap: "Bedroom 1" },
    { src: "assets/unitA/10-bedroom1-view.jpg", cap: "Bedroom 1" },
    { src: "assets/unitA/11-bedroom1-workspace.jpg", cap: "Bedroom 1 · workspace" },
    { src: "assets/unitA/12-bedroom1-closet.jpg", cap: "Bedroom 1 · walk-in closet" },
    { src: "assets/unitA/13-bedroom2.jpg", cap: "Bedroom 2" },
    { src: "assets/unitA/14-bedroom2-view.jpg", cap: "Bedroom 2" },
    { src: "assets/unitA/15-bedroom2-workspace.jpg", cap: "Bedroom 2 · workspace" },
    { src: "assets/unitA/16-full-bath-1.jpg", cap: "Full bath" },
    { src: "assets/unitA/17-full-bath-2.jpg", cap: "Full bath · shower" },
    { src: "assets/unitA/18-half-bath.jpg", cap: "Half bath" },
    { src: "assets/unitA/19-laundry.jpg", cap: "In-unit laundry" },
  ],
};

/* ---- Unit B (pet-friendly, biggest backyard) ---- */
const UNIT_B = {
  code: "Unit B", kicker: "Private Townhouse · Pet-friendly",
  title: "Entire Home in South Austin · Fully Furnished 2BR Near South Lamar",
  rating: "4.97", reviews: 32, petsOk: true, addr: ADDR_BASE,
  generalExtra: ["Outdoor furniture"],
  specs: ["4 guests", "2 bedrooms", "2 queen beds", "1.5 bathrooms"],
  overview: [
    OVERVIEW_BASE[0],
    "The open-concept first floor features a fully equipped quartz kitchen, living and dining areas, a half bath, and the largest private backyard of the three homes. Upstairs, two comfortable bedrooms with walk-in closets share a full bathroom — privacy and separation between living and working areas.",
    "Just 5 minutes from St. David's Medical Center and centrally located between I-35 and South Lamar, this is the only pet-friendly home in the fourplex — ideal for travel nurses, relocations, and anyone bringing a furry companion.",
    OVERVIEW_BASE[3],
  ],
  highlights: [
    { ic: "🐾", t: "Pet-friendly · up to 2" },
    { ic: "🌳", t: "Biggest private backyard" },
    { ic: "🅿️", t: "Free on-site parking · up to 2" },
    { ic: "🔑", t: "Seamless self check-in" },
  ],
  precautions: PRECAUT_BASE,
  rules: [
    { t: "Do not leave your pet unattended at any time — pets should not be left alone in the unit." },
    { t: "Pick up after your pet and clean up any messes they make." },
  ],
  gallery: [
    { src: "assets/unitB/04-living.avif", cap: "Living room" },
    { src: "assets/unitB/05-living-2.avif", cap: "Living room" },
    { src: "assets/unitB/06-kitchen.avif", cap: "Kitchen" },
    { src: "assets/unitB/07-kitchen-2.avif", cap: "Kitchen" },
    { src: "assets/unitB/08-kitchen-3.avif", cap: "Kitchen & breakfast bar" },
    { src: "assets/unitB/09-dining.avif", cap: "Dining area" },
    { src: "assets/unitB/01-bedroom1.avif", cap: "Bedroom 1" },
    { src: "assets/unitB/03-bedroom1-closet.avif", cap: "Bedroom 1 · walk-in closet" },
    { src: "assets/unitB/02-bedroom2.avif", cap: "Bedroom 2" },
    { src: "assets/unitB/10-full-bath.avif", cap: "Full bath" },
    { src: "assets/unitB/11-full-bath-2.avif", cap: "Full bath · shower" },
    { src: "assets/unitB/12-half-bath.avif", cap: "Half bath" },
    { src: "assets/unitB/13-laundry.avif", cap: "In-unit laundry" },
    { src: "assets/unitB/14-backyard.avif", cap: "Private backyard" },
  ],
};

/* ---- Unit D (highest rated) ---- */
const UNIT_D = {
  code: "Unit D", kicker: "Private Townhouse",
  title: "Private Home in South Austin · Fully Furnished 2BR Near South Lamar",
  rating: "5.0", reviews: 19, petsOk: false, addr: ADDR_BASE,
  generalExtra: ["Outdoor furniture"],
  specs: SPECS_BASE,
  overview: [
    OVERVIEW_BASE[0],
    OVERVIEW_BASE[1],
    "Our highest-rated home — a perfect ★5.0 for location — and a guest favorite for longer stays. Centrally located between I-35 and South Lamar, with easy access to downtown Austin, major employers, hospitals, and the city's best food and coffee.",
    OVERVIEW_BASE[3],
  ],
  highlights: [
    { ic: "🌿", t: "Cozy backyard" },
    { ic: "🗓️", t: "Great for long stays" },
    { ic: "📶", t: "Fast Wi-Fi & work desks" },
    { ic: "🔑", t: "Seamless self check-in" },
  ],
  precautions: PRECAUT_BASE,
  gallery: [
    { src: "assets/unitD/01-living.avif", cap: "Living room" },
    { src: "assets/unitD/02-living-2.avif", cap: "Living room" },
    { src: "assets/unitD/03-kitchen.avif", cap: "Kitchen & breakfast bar" },
    { src: "assets/unitD/04-kitchen-2.avif", cap: "Kitchen" },
    { src: "assets/unitD/05-kitchen-3.avif", cap: "Kitchen" },
    { src: "assets/unitD/06-dining.avif", cap: "Dining area" },
    { src: "assets/unitD/07-entryway.avif", cap: "Entryway · smart lock" },
    { src: "assets/unitD/08-bedroom1.avif", cap: "Bedroom 1" },
    { src: "assets/unitD/09-bedroom1-closet.avif", cap: "Bedroom 1 · walk-in closet" },
    { src: "assets/unitD/10-bedroom2.avif", cap: "Bedroom 2" },
    { src: "assets/unitD/11-full-bath.avif", cap: "Full bath" },
    { src: "assets/unitD/12-full-bath-2.avif", cap: "Full bath · shower" },
    { src: "assets/unitD/13-half-bath.avif", cap: "Half bath" },
    { src: "assets/unitD/14-laundry.avif", cap: "In-unit laundry" },
    { src: "assets/unitD/15-backyard.avif", cap: "Private backyard" },
  ],
};

/* ---- Booked date ranges (synced from each unit's Airbnb iCal) ---- */
UNIT_A.booked = [{ from: "2026-10-10", to: "2026-11-05" }];
UNIT_B.booked = [{ from: "2026-06-01", to: "2026-07-27" }];
UNIT_D.booked = [{ from: "2026-11-15", to: "2026-12-02" }];

/* Placeholder Airbnb iCal export links (owner connects these on build) */
UNIT_A.airbnb = "https://www.airbnb.com/calendar/ical/1001.ics?s=…";
UNIT_B.airbnb = "https://www.airbnb.com/calendar/ical/1002.ics?s=…";
UNIT_D.airbnb = "https://www.airbnb.com/calendar/ical/1003.ics?s=…";

/* ---- Unit lookup map (used by the Checkout / Confirmation pages) ---- */
window.RISE_UNITS = { A: UNIT_A, B: UNIT_B, D: UNIT_D };

/* ---- Guest reviews (imported from Airbnb · 2 per home) ---- */
const REVIEWS = [
  { n: "Geraldine", d: "December 2025", u: "Unit A", t: "Great location very convenient with lots do to nearby! Every space was clean and comfortable. The hosts are super responsive and accommodating, I can’t thank them enough. I’d definitely recommend." },
  { n: "Katie", d: "September 2025", u: "Unit A", t: "This was a great place to stay for my family. Wasn’t in downtown (which is what we wanted) but was a quick trip away. The place was super clean and newly remodeled. Absolutely loved it!" },
  { n: "Brennan", d: "March 2026", u: "Unit B", t: "Sean was responsive and proactive throughout the entire time from reservation to checkout. His place was as described and very easy to settle into when we arrived. The location made it easy to get to places like the gym, Costco, and the riverfront. Check out Lewis and Leroy BBQ; you can walk from his place, and it has a Michelin star." },
  { n: "Stacy", d: "October 2024", u: "Unit B", t: "This location is amazing. Very well maintained and outfitted. I love to cook and the kitchen had everything I needed. The oven and stove and refrigerator were so clean. It was as if they never been used. Great laundry facilities. Great furnishings. Quiet and very easily accessible. I would stay here again and absolutely recommend." },
  { n: "Swathi", d: "March 2026", u: "Unit D", t: "I stayed here for a month long stay. It was a good location, and a very spacious Airbnb. Had a great experience!" },
  { n: "Monica", d: "October 2024", u: "Unit D", t: "We needed a clean, comfortable & safe place for my family to stay while repairs were being done on our house, & Sean’s place was just what we needed. Super clean, comfy beds, well stocked kitchen, laundry in the unit, free parking, strong WiFi, close to amenities & public transportation. Sean is an incredible host, & his communication was the best of any place we have stayed. We will definitely look to stay here if we need a place again during our renovation." },
];
