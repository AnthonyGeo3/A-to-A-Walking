// The world view — how far from home each of you has walked.
//
// Every stamp in the app sits at its straight-line distance from Wrexham: steps
// ÷ 1,300 is the great-circle distance to the place, to within a few percent.
// So there is no route to draw. What there is, is a ring: everywhere exactly as
// far from home as you have walked. Pure: no DOM, no Leaflet.

import { HOME, STEPS_PER_KM, haversineKm } from './wrapped.js';

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * Where each place stamp is, by its label. Checked by journey.test.mjs: each one
 * has to sit at the distance its step count says (within 3% or 10 km).
 */
export const STAMP_COORDS = {
    "Birmingham 🏙️": [52.4862, -1.8904],
    "Cardiff 🐉": [51.4816, -3.1791],
    "Dublin 🍀": [53.3498, -6.2603],
    "London 💂": [51.5074, -0.1278],
    "Edinburgh 🏰": [55.9533, -3.1883],
    "Chunnel 🚇": [51.05, 1.33],
    "Calais 🇫🇷": [50.9513, 1.8587],
    "Bruges 🏰": [51.2093, 3.2247],
    "Amsterdam 🚲": [52.3676, 4.9041],
    "Brussels 🇧🇪": [50.8503, 4.3517],
    "Paris Border 🗼": [49.05, 2.4],
    "Eiffel Tower! 🎉": [48.8584, 2.2945],
    "Dortmund ⚽": [51.5136, 7.4653],
    "Geneva 🇨🇭": [46.2044, 6.1432],
    "Copenhagen 🧜‍♀️": [55.6761, 12.5683],
    "Gothenburg 🇸🇪": [57.7089, 11.9746],
    "Oslo 🇳🇴": [59.9139, 10.7522],
    "Munich 🍺": [48.1351, 11.582],
    "Milan 🇮🇹": [45.4642, 9.19],
    "Prague 🍺": [50.0755, 14.4378],
    "Monaco 🎰": [43.7384, 7.4246],
    "Barcelona ☀️": [41.3874, 2.1686],
    "Porto 🇵🇹": [41.1579, -8.6291],
    "Madrid 🇪🇸": [40.4168, -3.7038],
    "Florence 🎨": [43.7696, 11.2558],
    "Ljubljana 🇸🇮": [46.0569, 14.5058],
    "Bratislava 🇸🇰": [48.1486, 17.1077],
    "Palma de Mallorca 🏖️": [39.5696, 2.6502],
    "Zagreb 🇭🇷": [45.815, 15.9819],
    "Warsaw 🇵🇱": [52.2297, 21.0122],
    "Reykjavik 🇮🇸": [64.1466, -21.9426],
    "Lisbon 🇵🇹": [38.7223, -9.1393],
    "Rome 🏛️": [41.9028, 12.4964],
    "Seville 🏛️": [37.3891, -5.9845],
    "Cagliari 🏝️": [39.2238, 9.1217],
    "Tallinn 🇪🇪": [59.437, 24.7536],
    "Algiers 🇩🇿": [36.7538, 3.0588],
    "Gibraltar 🇬🇮": [36.1408, -5.3536],
    "Belgrade 🇷🇸": [44.7866, 20.4489],
    "Minsk 🇧🇾": [53.9006, 27.559],
    "Tunis 🇹🇳": [36.8065, 10.1815],
    "Tirana 🇦🇱": [41.3275, 19.8187],
    "Casablanca 🇲🇦": [33.5731, -7.5898],
    "Sofia 🇧🇬": [42.6977, 23.3219],
    "Corfu 🏝️": [39.6243, 19.9217],
    "Bucharest 🇷🇴": [44.4268, 26.1025],
    "Malta 🇲🇹": [35.8989, 14.5146],
    "Thessaloniki 🇬🇷": [40.6401, 22.9444],
    "Marrakesh 🇲🇦": [31.6295, -7.9811],
    "Odessa 🇺🇦": [46.4825, 30.7233],
    "Tripoli 🇱🇾": [32.8872, 13.1913],
    "Athens 🇬🇷": [37.9838, 23.7275],
    "Istanbul 🇹🇷": [41.0082, 28.9784],
    "Izmir 🇹🇷": [38.4237, 27.1428],
    "Santorini 🌋": [36.3932, 25.4615],
    "Kos 🏝️": [36.8933, 27.2889],
    "Benghazi 🇱🇾": [32.1167, 20.0667],
    "Paphos 🇨🇾": [34.7754, 32.4245],
    "Alexandria 🏛️": [31.2001, 29.9187],
    "Beirut 🇱🇧": [33.8938, 35.5018],
    "Cairo 🇪🇬": [30.0444, 31.2357],
    "Amman 🇯🇴": [31.9539, 35.9106],
    "Petra 🏜️": [30.3285, 35.4444],
    "Baku 🇦🇿": [40.4093, 49.8671],
    "Luxor 𓂀": [25.6872, 32.6396],
    "Baghdad 🇮🇶": [33.3152, 44.3661],
    "Tehran 🇮🇷": [35.6892, 51.389],
    "Isfahan 🕌": [32.6546, 51.668],
    "Riyadh 🇸🇦": [24.7136, 46.6753],
    "Accra 🇬🇭": [5.6037, -0.187],
    "Toronto 🇨🇦": [43.6532, -79.3832],
    "Bishkek 🇰🇬": [42.8746, 74.5698],
    "Dubai 🇦🇪": [25.2048, 55.2708],
    "Kabul 🇦🇫": [34.5553, 69.2075],
    "Muscat 🇴🇲": [23.588, 58.3829],
    "Chicago 🌭": [41.8781, -87.6298],
    "Karachi 🇵🇰": [24.8607, 67.0011],
    "Delhi 🇮🇳": [28.6139, 77.209],
    "Ulaanbaatar 🇲🇳": [47.8864, 106.9057],
    "Agra 🤍": [27.1751, 78.0421],
    "Kilimanjaro 🦓": [-3.0674, 37.3556],
    "Mumbai 🇮🇳": [19.076, 72.8777],
    "Kathmandu 🇳🇵": [27.7172, 85.324],
    "Varanasi 🪔": [25.3176, 82.9739],
    "Goa 🏖️": [15.2993, 74.124],
    "Grand Canyon 🏜️": [36.1069, -112.1129],
    "Las Vegas 🎰": [36.1699, -115.1398],
    "Beijing 🇨🇳": [39.9042, 116.4074],
    "Xi'an 🏺": [34.3416, 108.9398],
    "Chennai 🇮🇳": [13.0827, 80.2707],
    "Los Angeles 🌴": [34.0522, -118.2437],
    "Maldives 🐠": [4.1755, 73.5093],
    "Seoul 🇰🇷": [37.5665, 126.978],
    "Colombo 🇱🇰": [6.9271, 79.8612],
    "Yangon 🇲🇲": [16.8409, 96.1735],
    "Shanghai 🇨🇳": [31.2304, 121.4737],
    "Tokyo 🗼": [35.6762, 139.6503],
    "Bangkok 🇹🇭": [13.7563, 100.5018],
    "Hong Kong 🇭🇰": [22.3193, 114.1694],
    "Taipei 🇹🇼": [25.033, 121.5654],
    "Cape Town 🐧": [-33.9249, 18.4241],
    "Phuket 🏝️": [7.8804, 98.3923],
    "Phnom Penh 🇰🇭": [11.5564, 104.9282],
    "Ho Chi Minh City 🛵": [10.8231, 106.6297],
    "Medan 🌋": [3.5952, 98.6722],
    "Kuala Lumpur 🇲🇾": [3.139, 101.6869],
    "Singapore 🇸🇬": [1.3521, 103.8198],
    "Kota Kinabalu 🦧": [5.9804, 116.0735],
    "Brunei 🕌": [4.9031, 114.9398],
    "Palembang 🌉": [-2.9761, 104.7754],
    "Jakarta 🇮🇩": [-6.2088, 106.8456],
    "Guam 🌊": [13.4443, 144.7937],
    "Christmas Island 🦀": [-10.4475, 105.6904],
    "Yogyakarta 🛕": [-7.7956, 110.3695],
    "Surabaya 🦈": [-7.2575, 112.7521],
    "Mount Bromo 🌋": [-7.9425, 112.953],
    "Makassar ⛵": [-5.1477, 119.4327],
    "Bali 🏝️": [-8.4095, 115.1889],
    "Lombok 🌺": [-8.65, 116.3249],
    "Komodo 🦎": [-8.55, 119.4833],
    "Kupang 🌅": [-10.1772, 123.607],
    "Darwin 🇦🇺": [-12.4634, 130.8456],
    "Kakadu 🐊": [-12.9, 132.5],
    "Katherine 💦": [-14.4652, 132.2635],
    "Port Moresby 🇵🇬": [-9.4438, 147.1803],
    "Perth 🇦🇺": [-31.9505, 115.8605],
    "Tennant Creek 🌵": [-19.6497, 134.1914],
    "Kalgoorlie ⛏️": [-30.7489, 121.4658],
    "Uluru 🪨": [-25.3444, 131.0369],
    "Mount Isa ⚒️": [-20.7256, 139.4927],
    "Townsville 🐢": [-19.259, 146.8169],
    "Whitsundays 🤍": [-20.2826, 148.9618],
    "Longreach 🐑": [-23.4422, 144.2491],
    "Rockhampton 🥩": [-23.3791, 150.51],
    "Fiji 🌴": [-18.1416, 178.4419],
    "Fraser Island 🐕": [-25.2398, 153.1281],
    "Adelaide 🍷": [-34.9285, 138.6007],
    "Brisbane ☀️": [-27.4698, 153.0251],
    "Byron Bay 🏄": [-28.6474, 153.602],
    "Melbourne 🇦🇺": [-37.8136, 144.9631],
    "Sydney 🎇": [-33.8688, 151.2093],
    "Snowy Mountains 🎿": [-36.4, 148.4],
    "Lord Howe Island 🦜": [-31.5553, 159.0821],
    "Hobart 🍎": [-42.8821, 147.3272],
    "Cape Reinga 🌏": [-34.4285, 172.6807],
    "Bay of Islands ⛵": [-35.2333, 174.1167],
    "Auckland 🇳🇿": [-36.8485, 174.7633],
    "Hobbiton 🏡": [-37.8721, 175.6829],
    "Lake Taupō 🏞️": [-38.79, 175.89],
    "Wellington 🎬": [-41.2866, 174.7756],
    "Aoraki / Mt Cook 🏔️": [-43.595, 170.1418],
    "Christchurch 🌸": [-43.5321, 172.6362],
    "Queenstown 🏔️": [-45.0312, 168.6626]
};

/**
 * Stamps that aren't a place you could stand on, so they aren't drawn. Every
 * stamp is in exactly one of these two lists — the tests make sure of it.
 */
export const NOT_A_PLACE = [
    // Home: the code is public, so family addresses stay out of it. At world
    // zoom they'd sit on top of Wrexham anyway.
    "Amy's Parents 🏡", "Ant's Parents 🏠",
    // Distances, not destinations.
    'Long Trek 🚶‍♂️', 'Marathon 🏃‍♀️', '24h Walk 🌙', 'ISS 🛰️', 'Long Walk 🎞️', 'Week Walk 🗓️',
    'UK Length 🇬🇧', '£100M Line 💰', 'Route 66 Half 🛣️', 'Mordor 🌋', 'M25 × 16 🛣️',
    'Continental Divide 🥾', 'The Amazon 🛶', 'The Nile 🐊', 'Route 66 × 2 🚗', 'Trans-Siberian 🚂',
    "Britain's Coast 🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    // "Paris to Berlin!" — the distance between the two, not Wrexham to Berlin
    // (which is 1,100 km, not 881).
    'Berlin 🐻',
    'Everest × 300 🏔️', 'Everest × 500 🏔️', 'Everest × 1,550 ⛰️', 'Everest × 1,800 🗻',
    'Marathon × 280 🏅', 'Marathon × 320 🏃', 'Marathon × 340 🥇', 'Marathon × 410 🏆',
    '5 Million! 🎊', '6 Million 🎈', '7 Million 🎯', '7½ Million 🥳', '8 Million 💫', '9 Million ✨',
    '10 Million! 🏆', '11 Million 🎖️', '12 Million 🌟', '13 Million 🍀', '14 Million 🎉', '15 Million 🎆',
    '16 Million 🌠', '17 Million 🎇', '18 Million 🚩', '19 Million 🎊', '20 Million! 🌟', '21 Million 🎈',
    '22 Million 🎆', '23 Million 🌊', '24 Million 🥂'
];

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a, b) {
    const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lng - a.lng);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** The point `km` from `from` heading `bearingDeg`, along a great circle. */
export function destinationPoint(from, bearingDeg, km) {
    const δ = km / R, θ = rad(bearingDeg), φ1 = rad(from.lat), λ1 = rad(from.lng);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: deg(φ2), lng: ((deg(λ2) + 540) % 360) - 180 };
}

/**
 * Everywhere `km` from home, as lines ready to draw: a list of segments, split
 * wherever the ring crosses the date line so it doesn't streak across the map.
 * Drawn as lines, never filled — past ~10,000 km the ring encloses the far side
 * of the world, and a fill would shade the wrong half.
 */
export function ringSegments(km, { home = HOME, steps = 180 } = {}) {
    if (!(km > 0)) return [];
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(destinationPoint(home, (360 * i) / steps, km));
    const segments = [[]];
    pts.forEach((p, i) => {
        if (i > 0 && Math.abs(p.lng - pts[i - 1].lng) > 180) segments.push([]);
        segments[segments.length - 1].push([p.lat, p.lng]);
    });
    return segments.filter((s) => s.length > 1);
}

/** Every stamp that is a place, in step order, with its coordinates. */
export function placeStamps(milestones) {
    return (milestones || [])
        .filter((m) => STAMP_COORDS[m.label])
        .map((m) => ({ ...m, lat: STAMP_COORDS[m.label][0], lng: STAMP_COORDS[m.label][1] }))
        .sort((a, b) => a.steps - b.steps);
}

/**
 * Where someone with `steps` is: how far from home, the next place stamp, and a
 * point on their ring facing it. Past the last stamp, they face the last one.
 */
export function positionFor(steps, milestones, { home = HOME } = {}) {
    const km = Math.max(0, steps || 0) / STEPS_PER_KM;
    const places = placeStamps(milestones);
    const next = places.find((p) => p.steps > steps) || null;
    const last = [...places].reverse().find((p) => p.steps <= steps) || null;
    const facing = next || last;
    const b = facing ? bearing(home, facing) : 0;
    return {
        km,
        next,
        last,
        toGo: next ? next.steps - steps : 0,
        bearing: b,
        point: km > 0 ? destinationPoint(home, b, km) : { lat: home.lat, lng: home.lng }
    };
}

/** Distance between a stamp's coordinates and where its steps say it is, as a fraction. */
export function stampError(stamp, { home = HOME } = {}) {
    const want = stamp.steps / STEPS_PER_KM;
    const got = haversineKm(home, stamp);
    return { want, got, km: Math.abs(got - want), frac: Math.abs(got - want) / want };
}
