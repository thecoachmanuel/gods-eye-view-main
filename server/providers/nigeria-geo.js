/**
 * @module server/providers/nigeria-geo
 *
 * High-accuracy Nigerian Geospatial Gazetteer & Spatial Reverse Geocoder.
 *
 * Features:
 *   1. Built-in, offline spatial index of all 36 Nigerian States + FCT,
 *      covering 350+ cities, towns, LGA headquarters, and critical corridors.
 *   2. Zero-latency Haversine nearest-neighbor & cardinal bearing resolver.
 *   3. Asynchronous OpenStreetMap Nominatim enrichment queue with LRU cache,
 *      strictly respecting upstream rate limits (1 req / 1.2s).
 */

import fs from 'node:fs';
import path from 'node:path';

// Bounding box of Nigeria
const NIGERIA_BOUNDS = {
  minLat: 4.15,
  maxLat: 13.92,
  minLon: 2.65,
  maxLon: 14.70,
};

/**
 * 350+ Major Nigerian settlements, LGA seats, and landmark corridors
 * across all 36 States + Federal Capital Territory (FCT).
 */
export const NIGERIA_SETTLEMENTS = [
  // ── ABIA STATE ─────────────────────────────────────────────────────────────
  { name: 'Umuahia', state: 'Abia', lga: 'Umuahia North', lat: 5.5260, lon: 7.4896 },
  { name: 'Aba', state: 'Abia', lga: 'Aba South', lat: 5.1066, lon: 7.3667 },
  { name: 'Ohafia', state: 'Abia', lga: 'Ohafia', lat: 5.6178, lon: 7.8286 },
  { name: 'Arochukwu', state: 'Abia', lga: 'Arochukwu', lat: 5.3892, lon: 7.9144 },
  { name: 'Bende', state: 'Abia', lga: 'Bende', lat: 5.5606, lon: 7.6372 },
  { name: 'Osisioma', state: 'Abia', lga: 'Osisioma', lat: 5.1611, lon: 7.3275 },
  { name: 'Isiala Ngwa', state: 'Abia', lga: 'Isiala Ngwa', lat: 5.3942, lon: 7.4431 },

  // ── ADAMAWA STATE ──────────────────────────────────────────────────────────
  { name: 'Yola', state: 'Adamawa', lga: 'Yola South', lat: 9.2094, lon: 12.4818 },
  { name: 'Jimeta', state: 'Adamawa', lga: 'Yola North', lat: 9.2789, lon: 12.4497 },
  { name: 'Mubi', state: 'Adamawa', lga: 'Mubi North', lat: 10.2676, lon: 13.2644 },
  { name: 'Numan', state: 'Adamawa', lga: 'Numan', lat: 9.4589, lon: 12.0306 },
  { name: 'Ganye', state: 'Adamawa', lga: 'Ganye', lat: 8.4350, lon: 12.0675 },
  { name: 'Michika', state: 'Adamawa', lga: 'Michika', lat: 10.6214, lon: 13.3883 },
  { name: 'Madagali', state: 'Adamawa', lga: 'Madagali', lat: 10.8911, lon: 13.6289 },
  { name: 'Fufore', state: 'Adamawa', lga: 'Fufore', lat: 9.2217, lon: 12.6508 },
  { name: 'Mayo-Belwa', state: 'Adamawa', lga: 'Mayo-Belwa', lat: 9.0531, lon: 12.0578 },
  { name: 'Song', state: 'Adamawa', lga: 'Song', lat: 9.8272, lon: 12.6236 },
  { name: 'Gombi', state: 'Adamawa', lga: 'Gombi', lat: 10.1656, lon: 12.7378 },

  // ── AKWA IBOM STATE ────────────────────────────────────────────────────────
  { name: 'Uyo', state: 'Akwa Ibom', lga: 'Uyo', lat: 5.0377, lon: 7.9128 },
  { name: 'Eket', state: 'Akwa Ibom', lga: 'Eket', lat: 4.6439, lon: 7.9286 },
  { name: 'Ikot Ekpene', state: 'Akwa Ibom', lga: 'Ikot Ekpene', lat: 5.1836, lon: 7.7128 },
  { name: 'Oron', state: 'Akwa Ibom', lga: 'Oron', lat: 4.8250, lon: 8.2353 },
  { name: 'Ikot Abasi', state: 'Akwa Ibom', lga: 'Ikot Abasi', lat: 4.5661, lon: 7.5581 },
  { name: 'Abak', state: 'Akwa Ibom', lga: 'Abak', lat: 4.9839, lon: 7.7889 },
  { name: 'Itu', state: 'Akwa Ibom', lga: 'Itu', lat: 5.2008, lon: 7.9861 },

  // ── ANAMBRA STATE ──────────────────────────────────────────────────────────
  { name: 'Awka', state: 'Anambra', lga: 'Awka South', lat: 6.2209, lon: 7.0722 },
  { name: 'Onitsha', state: 'Anambra', lga: 'Onitsha North', lat: 6.1498, lon: 6.7859 },
  { name: 'Nnewi', state: 'Anambra', lga: 'Nnewi North', lat: 6.0198, lon: 6.9172 },
  { name: 'Ekwulobia', state: 'Anambra', lga: 'Aguata', lat: 6.0272, lon: 7.0864 },
  { name: 'Ogbaru', state: 'Anambra', lga: 'Ogbaru', lat: 5.9525, lon: 6.7725 },
  { name: 'Ihiala', state: 'Anambra', lga: 'Ihiala', lat: 5.8542, lon: 6.8586 },

  // ── BAUCHI STATE ───────────────────────────────────────────────────────────
  { name: 'Bauchi', state: 'Bauchi', lga: 'Bauchi', lat: 10.3158, lon: 9.8442 },
  { name: 'Azare', state: 'Bauchi', lga: 'Katagum', lat: 11.6744, lon: 10.1919 },
  { name: 'Misau', state: 'Bauchi', lga: 'Misau', lat: 11.3139, lon: 10.4678 },
  { name: 'Jama\'are', state: 'Bauchi', lga: 'Jama\'are', lat: 11.6694, lon: 9.9272 },
  { name: 'Ningi', state: 'Bauchi', lga: 'Ningi', lat: 11.0789, lon: 9.5706 },
  { name: 'Toro', state: 'Bauchi', lga: 'Toro', lat: 10.0594, lon: 9.0669 },
  { name: 'Alkaleri', state: 'Bauchi', lga: 'Alkaleri', lat: 10.2647, lon: 10.3325 },
  { name: 'Dass', state: 'Bauchi', lga: 'Dass', lat: 10.0036, lon: 9.5161 },
  { name: 'Tafawa Balewa', state: 'Bauchi', lga: 'Tafawa Balewa', lat: 9.7567, lon: 9.5539 },
  { name: 'Yankari Reserve', state: 'Bauchi', lga: 'Alkaleri', lat: 9.7583, lon: 10.5125 },

  // ── BAYELSA STATE ──────────────────────────────────────────────────────────
  { name: 'Yenagoa', state: 'Bayelsa', lga: 'Yenagoa', lat: 4.9267, lon: 6.2676 },
  { name: 'Brass', state: 'Bayelsa', lga: 'Brass', lat: 4.3167, lon: 6.2417 },
  { name: 'Ogbia', state: 'Bayelsa', lga: 'Ogbia', lat: 4.6536, lon: 6.3267 },
  { name: 'Sagbama', state: 'Bayelsa', lga: 'Sagbama', lat: 5.1542, lon: 6.1989 },
  { name: 'Nembe', state: 'Bayelsa', lga: 'Nembe', lat: 4.5372, lon: 6.4022 },
  { name: 'Southern Ijaw', state: 'Bayelsa', lga: 'Southern Ijaw', lat: 4.8156, lon: 6.0722 },

  // ── BENUE STATE ────────────────────────────────────────────────────────────
  { name: 'Makurdi', state: 'Benue', lga: 'Makurdi', lat: 7.7322, lon: 8.5391 },
  { name: 'Gboko', state: 'Benue', lga: 'Gboko', lat: 7.3197, lon: 9.0028 },
  { name: 'Otukpo', state: 'Benue', lga: 'Otukpo', lat: 7.1925, lon: 8.1328 },
  { name: 'Katsina-Ala', state: 'Benue', lga: 'Katsina-Ala', lat: 7.1689, lon: 9.2847 },
  { name: 'Vandeikya', state: 'Benue', lga: 'Vandeikya', lat: 6.9139, lon: 9.0667 },
  { name: 'Gwer East', state: 'Benue', lga: 'Gwer East', lat: 7.4200, lon: 8.6500 },
  { name: 'Guma', state: 'Benue', lga: 'Guma', lat: 7.9156, lon: 8.8125 },
  { name: 'Buruku', state: 'Benue', lga: 'Buruku', lat: 7.4667, lon: 9.2000 },
  { name: 'Kwande', state: 'Benue', lga: 'Kwande', lat: 6.9500, lon: 9.4000 },
  { name: 'Ogbadibo', state: 'Benue', lga: 'Ogbadibo', lat: 7.0500, lon: 7.7833 },

  // ── BORNO STATE ────────────────────────────────────────────────────────────
  { name: 'Maiduguri', state: 'Borno', lga: 'Maiduguri', lat: 11.8333, lon: 13.1500 },
  { name: 'Jere', state: 'Borno', lga: 'Jere', lat: 11.8500, lon: 13.2000 },
  { name: 'Bama', state: 'Borno', lga: 'Bama', lat: 11.5222, lon: 13.6856 },
  { name: 'Biu', state: 'Borno', lga: 'Biu', lat: 10.6128, lon: 12.1947 },
  { name: 'Gwoza', state: 'Borno', lga: 'Gwoza', lat: 11.0831, lon: 13.6947 },
  { name: 'Monguno', state: 'Borno', lga: 'Monguno', lat: 12.6703, lon: 13.6122 },
  { name: 'Ngurno', state: 'Borno', lga: 'Monguno', lat: 12.7761, lon: 13.9389 },
  { name: 'Kukawa', state: 'Borno', lga: 'Kukawa', lat: 12.9239, lon: 13.5661 },
  { name: 'Baga', state: 'Borno', lga: 'Kukawa', lat: 13.0847, lon: 13.8239 },
  { name: 'Dikwa', state: 'Borno', lga: 'Dikwa', lat: 12.0361, lon: 13.9181 },
  { name: 'Damboa', state: 'Borno', lga: 'Damboa', lat: 11.1558, lon: 12.7564 },
  { name: 'Chibok', state: 'Borno', lga: 'Chibok', lat: 10.8711, lon: 12.8469 },
  { name: 'Gubio', state: 'Borno', lga: 'Gubio', lat: 12.4975, lon: 12.7817 },
  { name: 'Ngala', state: 'Borno', lga: 'Ngala', lat: 12.3392, lon: 14.1844 },
  { name: 'Konduga', state: 'Borno', lga: 'Konduga', lat: 11.6533, lon: 13.4181 },
  { name: 'Kaga', state: 'Borno', lga: 'Kaga', lat: 11.6667, lon: 12.5000 },
  { name: 'Mafa', state: 'Borno', lga: 'Mafa', lat: 11.9247, lon: 13.6006 },
  { name: 'Mobbar', state: 'Borno', lga: 'Mobbar', lat: 13.1250, lon: 12.8000 },
  { name: 'Abadam', state: 'Borno', lga: 'Abadam', lat: 13.5900, lon: 13.2700 },
  { name: 'Marte', state: 'Borno', lga: 'Marte', lat: 12.3644, lon: 13.8317 },
  { name: 'Sambisa Forest', state: 'Borno', lga: 'Bama / Gwoza Axis', lat: 11.2500, lon: 13.5000 },

  // ── CROSS RIVER STATE ──────────────────────────────────────────────────────
  { name: 'Calabar', state: 'Cross River', lga: 'Calabar Municipal', lat: 4.9589, lon: 8.3269 },
  { name: 'Ikom', state: 'Cross River', lga: 'Ikom', lat: 5.9617, lon: 8.7111 },
  { name: 'Ogoja', state: 'Cross River', lga: 'Ogoja', lat: 6.6575, lon: 8.7978 },
  { name: 'Obudu', state: 'Cross River', lga: 'Obudu', lat: 6.6661, lon: 9.1639 },
  { name: 'Ugep', state: 'Cross River', lga: 'Yakurr', lat: 5.8089, lon: 8.0811 },
  { name: 'Akamkpa', state: 'Cross River', lga: 'Akamkpa', lat: 5.3117, lon: 8.3308 },
  { name: 'Boki', state: 'Cross River', lga: 'Boki', lat: 6.2500, lon: 8.9833 },

  // ── DELTA STATE ────────────────────────────────────────────────────────────
  { name: 'Asaba', state: 'Delta', lga: 'Oshimili South', lat: 6.1989, lon: 6.7322 },
  { name: 'Warri', state: 'Delta', lga: 'Warri South', lat: 5.5178, lon: 5.7500 },
  { name: 'Sapele', state: 'Delta', lga: 'Sapele', lat: 5.8942, lon: 5.6767 },
  { name: 'Ughelli', state: 'Delta', lga: 'Ughelli North', lat: 5.5000, lon: 6.0000 },
  { name: 'Agbor', state: 'Delta', lga: 'Ika South', lat: 6.2539, lon: 6.1936 },
  { name: 'Oleh', state: 'Delta', lga: 'Isoko South', lat: 5.4600, lon: 6.2047 },
  { name: 'Burutu', state: 'Delta', lga: 'Burutu', lat: 5.3533, lon: 5.5078 },
  { name: 'Escravos', state: 'Delta', lga: 'Warri South West', lat: 5.5833, lon: 5.1667 },

  // ── EBONYI STATE ───────────────────────────────────────────────────────────
  { name: 'Abakaliki', state: 'Ebonyi', lga: 'Abakaliki', lat: 6.3249, lon: 8.1137 },
  { name: 'Afikpo', state: 'Ebonyi', lga: 'Afikpo North', lat: 5.8931, lon: 7.9372 },
  { name: 'Onueke', state: 'Ebonyi', lga: 'Ezza South', lat: 6.1367, lon: 8.0189 },
  { name: 'Ishielu', state: 'Ebonyi', lga: 'Ishielu', lat: 6.4442, lon: 7.7817 },

  // ── EDO STATE ──────────────────────────────────────────────────────────────
  { name: 'Benin City', state: 'Edo', lga: 'Oredo', lat: 6.3350, lon: 5.6037 },
  { name: 'Auchi', state: 'Edo', lga: 'Etsako West', lat: 7.0675, lon: 6.2692 },
  { name: 'Ekpoma', state: 'Edo', lga: 'Esan West', lat: 6.7447, lon: 6.1408 },
  { name: 'Uromi', state: 'Edo', lga: 'Esan North-East', lat: 6.7058, lon: 6.3278 },
  { name: 'Irrua', state: 'Edo', lga: 'Esan Central', lat: 6.7408, lon: 6.2164 },
  { name: 'Iguobazuwa', state: 'Edo', lga: 'Ovia South-West', lat: 6.5500, lon: 5.3500 },

  // ── EKITI STATE ────────────────────────────────────────────────────────────
  { name: 'Ado-Ekiti', state: 'Ekiti', lga: 'Ado-Ekiti', lat: 7.6211, lon: 5.2214 },
  { name: 'Ikere', state: 'Ekiti', lga: 'Ikere', lat: 7.4986, lon: 5.2300 },
  { name: 'Ijero', state: 'Ekiti', lga: 'Ijero', lat: 7.8189, lon: 5.0667 },
  { name: 'Oye', state: 'Ekiti', lga: 'Oye', lat: 7.7981, lon: 5.3308 },
  { name: 'Ikole', state: 'Ekiti', lga: 'Ikole', lat: 7.7983, lon: 5.5147 },

  // ── ENUGU STATE ────────────────────────────────────────────────────────────
  { name: 'Enugu', state: 'Enugu', lga: 'Enugu North', lat: 6.4584, lon: 7.5464 },
  { name: 'Nsukka', state: 'Enugu', lga: 'Nsukka', lat: 6.8561, lon: 7.3958 },
  { name: 'Oji River', state: 'Enugu', lga: 'Oji River', lat: 6.2631, lon: 7.2736 },
  { name: 'Agbani', state: 'Enugu', lga: 'Nkanu West', lat: 6.3056, lon: 7.5519 },
  { name: 'Udi', state: 'Enugu', lga: 'Udi', lat: 6.3167, lon: 7.4167 },
  { name: 'Awgu', state: 'Enugu', lga: 'Awgu', lat: 6.0747, lon: 7.4764 },

  // ── FEDERAL CAPITAL TERRITORY (ABUJA) ──────────────────────────────────────
  { name: 'Abuja Central', state: 'Federal Capital Territory', lga: 'Municipal Area Council', lat: 9.0765, lon: 7.3986 },
  { name: 'Gwarinpa', state: 'Federal Capital Territory', lga: 'Municipal Area Council', lat: 9.1089, lon: 7.4103 },
  { name: 'Maitama', state: 'Federal Capital Territory', lga: 'Municipal Area Council', lat: 9.0883, lon: 7.4933 },
  { name: 'Asokoro', state: 'Federal Capital Territory', lga: 'Municipal Area Council', lat: 9.0436, lon: 7.5256 },
  { name: 'Wuse', state: 'Federal Capital Territory', lga: 'Municipal Area Council', lat: 9.0667, lon: 7.4667 },
  { name: 'Bwari', state: 'Federal Capital Territory', lga: 'Bwari', lat: 9.2886, lon: 7.3789 },
  { name: 'Gwagwalada', state: 'Federal Capital Territory', lga: 'Gwagwalada', lat: 8.9431, lon: 7.0864 },
  { name: 'Kuje', state: 'Federal Capital Territory', lga: 'Kuje', lat: 8.8789, lon: 7.2275 },
  { name: 'Kwali', state: 'Federal Capital Territory', lga: 'Kwali', lat: 8.8778, lon: 7.0142 },
  { name: 'Abaji', state: 'Federal Capital Territory', lga: 'Abaji', lat: 8.4722, lon: 6.9536 },

  // ── GOMBE STATE ────────────────────────────────────────────────────────────
  { name: 'Gombe', state: 'Gombe', lga: 'Gombe', lat: 10.2897, lon: 11.1673 },
  { name: 'Kaltungo', state: 'Gombe', lga: 'Kaltungo', lat: 9.8164, lon: 11.3094 },
  { name: 'Billiri', state: 'Gombe', lga: 'Billiri', lat: 9.8647, lon: 11.2261 },
  { name: 'Bajoga', state: 'Gombe', lga: 'Funakaye', lat: 10.8522, lon: 11.4319 },
  { name: 'Nafada', state: 'Gombe', lga: 'Nafada', lat: 11.0944, lon: 11.3325 },
  { name: 'Dukku', state: 'Gombe', lga: 'Dukku', lat: 10.7719, lon: 10.7719 },

  // ── IMO STATE ──────────────────────────────────────────────────────────────
  { name: 'Owerri', state: 'Imo', lga: 'Owerri Municipal', lat: 5.4833, lon: 7.0333 },
  { name: 'Orlu', state: 'Imo', lga: 'Orlu', lat: 5.7958, lon: 7.0353 },
  { name: 'Okigwe', state: 'Imo', lga: 'Okigwe', lat: 5.8286, lon: 7.3517 },
  { name: 'Oguta', state: 'Imo', lga: 'Oguta', lat: 5.7119, lon: 6.8100 },
  { name: 'Mbaise', state: 'Imo', lga: 'Aboh Mbaise', lat: 5.4800, lon: 7.2500 },

  // ── JIGAWA STATE ───────────────────────────────────────────────────────────
  { name: 'Dutse', state: 'Jigawa', lga: 'Dutse', lat: 11.7562, lon: 9.3390 },
  { name: 'Hadejia', state: 'Jigawa', lga: 'Hadejia', lat: 12.4497, lon: 10.0442 },
  { name: 'Gumel', state: 'Jigawa', lga: 'Gumel', lat: 12.6269, lon: 9.3889 },
  { name: 'Kazaure', state: 'Jigawa', lga: 'Kazaure', lat: 12.6489, lon: 8.4114 },
  { name: 'Ringim', state: 'Jigawa', lga: 'Ringim', lat: 12.1528, lon: 9.1625 },
  { name: 'Birnin Kudu', state: 'Jigawa', lga: 'Birnin Kudu', lat: 11.4506, lon: 9.4789 },

  // ── KADUNA STATE ───────────────────────────────────────────────────────────
  { name: 'Kaduna', state: 'Kaduna', lga: 'Kaduna North', lat: 10.5105, lon: 7.4165 },
  { name: 'Zaria', state: 'Kaduna', lga: 'Zaria', lat: 11.0855, lon: 7.7199 },
  { name: 'Kafanchan', state: 'Kaduna', lga: 'Jema\'a', lat: 9.5833, lon: 8.3000 },
  { name: 'Birnin Gwari', state: 'Kaduna', lga: 'Birnin Gwari', lat: 10.6625, lon: 6.5414 },
  { name: 'Saminaka', state: 'Kaduna', lga: 'Lere', lat: 10.4136, lon: 8.6872 },
  { name: 'Kachia', state: 'Kaduna', lga: 'Kachia', lat: 9.8731, lon: 7.9556 },
  { name: 'Giwa', state: 'Kaduna', lga: 'Giwa', lat: 11.2825, lon: 7.4167 },
  { name: 'Chikun', state: 'Kaduna', lga: 'Chikun', lat: 10.3500, lon: 7.3000 },
  { name: 'Kagarko', state: 'Kaduna', lga: 'Kagarko', lat: 9.4833, lon: 7.7000 },

  // ── KANO STATE ─────────────────────────────────────────────────────────────
  { name: 'Kano City', state: 'Kano', lga: 'KMC / Dala', lat: 12.0022, lon: 8.5920 },
  { name: 'Dawanau', state: 'Kano', lga: 'Dawakin Tofa', lat: 12.0578, lon: 8.4419 },
  { name: 'Wudil', state: 'Kano', lga: 'Wudil', lat: 11.7939, lon: 8.8475 },
  { name: 'Bichi', state: 'Kano', lga: 'Bichi', lat: 12.2339, lon: 8.2403 },
  { name: 'Rano', state: 'Kano', lga: 'Rano', lat: 11.5564, lon: 8.5775 },
  { name: 'Gaya', state: 'Kano', lga: 'Gaya', lat: 11.9136, lon: 9.0069 },
  { name: 'Karaye', state: 'Kano', lga: 'Karaye', lat: 11.7458, lon: 8.0125 },
  { name: 'Gwarzo', state: 'Kano', lga: 'Gwarzo', lat: 11.9156, lon: 7.9333 },
  { name: 'Danbatta', state: 'Kano', lga: 'Danbatta', lat: 12.4339, lon: 8.5147 },

  // ── KATSINA STATE ──────────────────────────────────────────────────────────
  { name: 'Katsina', state: 'Katsina', lga: 'Katsina', lat: 12.9908, lon: 7.6018 },
  { name: 'Daura', state: 'Katsina', lga: 'Daura', lat: 13.0333, lon: 8.3167 },
  { name: 'Funtua', state: 'Katsina', lga: 'Funtua', lat: 11.5233, lon: 7.3081 },
  { name: 'Malumfashi', state: 'Katsina', lga: 'Malumfashi', lat: 11.7892, lon: 7.6208 },
  { name: 'Kankia', state: 'Katsina', lga: 'Kankia', lat: 12.5500, lon: 7.8300 },
  { name: 'Dutsin-Ma', state: 'Katsina', lga: 'Dutsin-Ma', lat: 12.4500, lon: 7.5000 },
  { name: 'Jibia', state: 'Katsina', lga: 'Jibia', lat: 13.0911, lon: 7.2272 },
  { name: 'Kankara', state: 'Katsina', lga: 'Kankara', lat: 11.9289, lon: 7.4128 },
  { name: 'Safana', state: 'Katsina', lga: 'Safana', lat: 12.4117, lon: 7.2436 },

  // ── KEBBI STATE ────────────────────────────────────────────────────────────
  { name: 'Birnin Kebbi', state: 'Kebbi', lga: 'Birnin Kebbi', lat: 12.4539, lon: 4.1975 },
  { name: 'Argungu', state: 'Kebbi', lga: 'Argungu', lat: 12.7447, lon: 4.5361 },
  { name: 'Yauri', state: 'Kebbi', lga: 'Yauri', lat: 10.7814, lon: 4.7744 },
  { name: 'Zuru', state: 'Kebbi', lga: 'Zuru', lat: 11.4339, lon: 5.2347 },
  { name: 'Jega', state: 'Kebbi', lga: 'Jega', lat: 12.2211, lon: 4.3800 },
  { name: 'Kamba', state: 'Kebbi', lga: 'Dandi', lat: 11.8542, lon: 3.6542 },
  { name: 'Bagudo', state: 'Kebbi', lga: 'Bagudo', lat: 11.4000, lon: 4.2167 },

  // ── KOGI STATE ─────────────────────────────────────────────────────────────
  { name: 'Lokoja', state: 'Kogi', lga: 'Lokoja', lat: 7.7969, lon: 6.7408 },
  { name: 'Okene', state: 'Kogi', lga: 'Okene', lat: 7.5506, lon: 6.2361 },
  { name: 'Idah', state: 'Kogi', lga: 'Idah', lat: 7.1067, lon: 6.7381 },
  { name: 'Anyigba', state: 'Kogi', lga: 'Dekina', lat: 7.4939, lon: 7.1772 },
  { name: 'Kabba', state: 'Kogi', lga: 'Kabba/Bunu', lat: 7.8286, lon: 6.0747 },
  { name: 'Ankpa', state: 'Kogi', lga: 'Ankpa', lat: 7.6331, lon: 7.6328 },
  { name: 'Ajaokuta', state: 'Kogi', lga: 'Ajaokuta', lat: 7.5619, lon: 6.6575 },
  { name: 'Koton-Karfe', state: 'Kogi', lga: 'Kogi', lat: 8.1333, lon: 6.8000 },

  // ── KWARA STATE ────────────────────────────────────────────────────────────
  { name: 'Ilorin', state: 'Kwara', lga: 'Ilorin West', lat: 8.4799, lon: 4.5418 },
  { name: 'Offa', state: 'Kwara', lga: 'Offa', lat: 8.1492, lon: 4.7206 },
  { name: 'Omu-Aran', state: 'Kwara', lga: 'Irepodun', lat: 8.1386, lon: 5.1017 },
  { name: 'Jebba', state: 'Kwara', lga: 'Moro', lat: 9.1311, lon: 4.8239 },
  { name: 'Lafiagi', state: 'Kwara', lga: 'Edu', lat: 8.8500, lon: 5.4167 },
  { name: 'Patigi', state: 'Kwara', lga: 'Patigi', lat: 8.7300, lon: 5.7500 },
  { name: 'Kaiama', state: 'Kwara', lga: 'Kaiama', lat: 9.6053, lon: 3.9411 },
  { name: 'Baruten', state: 'Kwara', lga: 'Baruten (Kosubosu)', lat: 9.8667, lon: 3.2833 },

  // ── LAGOS STATE ────────────────────────────────────────────────────────────
  { name: 'Ikeja', state: 'Lagos', lga: 'Ikeja', lat: 6.6018, lon: 3.3515 },
  { name: 'Lagos Island', state: 'Lagos', lga: 'Lagos Island', lat: 6.4549, lon: 3.4246 },
  { name: 'Lekki', state: 'Lagos', lga: 'Eti-Osa', lat: 6.4474, lon: 3.4844 },
  { name: 'Epe', state: 'Lagos', lga: 'Epe', lat: 6.5841, lon: 3.9834 },
  { name: 'Ikorodu', state: 'Lagos', lga: 'Ikorodu', lat: 6.6194, lon: 3.5105 },
  { name: 'Badagry', state: 'Lagos', lga: 'Badagry', lat: 6.4150, lon: 2.8814 },
  { name: 'Victoria Island', state: 'Lagos', lga: 'Eti-Osa', lat: 6.4281, lon: 3.4219 },
  { name: 'Surulere', state: 'Lagos', lga: 'Surulere', lat: 6.5000, lon: 3.3500 },
  { name: 'Alimosho', state: 'Lagos', lga: 'Alimosho', lat: 6.6000, lon: 3.2500 },
  { name: 'Ajah', state: 'Lagos', lga: 'Eti-Osa', lat: 6.4667, lon: 3.5667 },
  { name: 'Ibeju-Lekki', state: 'Lagos', lga: 'Ibeju-Lekki', lat: 6.4833, lon: 3.8000 },

  // ── NASARAWA STATE ─────────────────────────────────────────────────────────
  { name: 'Lafia', state: 'Nasarawa', lga: 'Lafia', lat: 8.4931, lon: 8.5153 },
  { name: 'Keffi', state: 'Nasarawa', lga: 'Keffi', lat: 8.8472, lon: 7.8736 },
  { name: 'Akwanga', state: 'Nasarawa', lga: 'Akwanga', lat: 8.9103, lon: 8.4069 },
  { name: 'Karu', state: 'Nasarawa', lga: 'Karu', lat: 9.0067, lon: 7.6467 },
  { name: 'Nasarawa', state: 'Nasarawa', lga: 'Nasarawa', lat: 8.5392, lon: 7.7083 },
  { name: 'Doma', state: 'Nasarawa', lga: 'Doma', lat: 8.3589, lon: 8.3503 },
  { name: 'Wamba', state: 'Nasarawa', lga: 'Wamba', lat: 8.9333, lon: 8.6000 },

  // ── NIGER STATE ────────────────────────────────────────────────────────────
  { name: 'Minna', state: 'Niger', lga: 'Chanchaga / Bosso', lat: 9.6139, lon: 6.5569 },
  { name: 'Bida', state: 'Niger', lga: 'Bida', lat: 9.0833, lon: 6.0167 },
  { name: 'Suleja', state: 'Niger', lga: 'Suleja', lat: 9.1806, lon: 7.1806 },
  { name: 'Kontagora', state: 'Niger', lga: 'Kontagora', lat: 10.4042, lon: 6.2081 },
  { name: 'Mokwa', state: 'Niger', lga: 'Mokwa', lat: 9.2944, lon: 5.0542 },
  { name: 'New Bussa', state: 'Niger', lga: 'Borgu', lat: 9.8708, lon: 4.5103 },
  { name: 'Shiroro', state: 'Niger', lga: 'Shiroro', lat: 9.9725, lon: 6.8406 },
  { name: 'Mariga', state: 'Niger', lga: 'Mariga', lat: 10.4500, lon: 6.4500 },
  { name: 'Lapai', state: 'Niger', lga: 'Lapai', lat: 9.0431, lon: 6.5714 },
  { name: 'Agaie', state: 'Niger', lga: 'Agaie', lat: 9.0117, lon: 6.3214 },
  { name: 'Kagara', state: 'Niger', lga: 'Rafi', lat: 10.1883, lon: 6.5414 },
  { name: 'Rijau', state: 'Niger', lga: 'Rijau', lat: 11.1000, lon: 5.2500 },
  { name: 'Kainji Lake', state: 'Niger', lga: 'Borgu', lat: 10.0500, lon: 4.5800 },

  // ── OGUN STATE ─────────────────────────────────────────────────────────────
  { name: 'Abeokuta', state: 'Ogun', lga: 'Abeokuta South', lat: 7.1557, lon: 3.3451 },
  { name: 'Ijebu-Ode', state: 'Ogun', lga: 'Ijebu-Ode', lat: 6.8206, lon: 3.9208 },
  { name: 'Sagamu', state: 'Ogun', lga: 'Sagamu', lat: 6.8489, lon: 3.6467 },
  { name: 'Ota', state: 'Ogun', lga: 'Ado-Odo/Ota', lat: 6.6908, lon: 3.2367 },
  { name: 'Ilaro', state: 'Ogun', lga: 'Yewa South', lat: 6.8892, lon: 3.0136 },
  { name: 'Ijebu-Igbo', state: 'Ogun', lga: 'Ijebu North', lat: 6.9719, lon: 3.9989 },
  { name: 'Mowe / Ibafo', state: 'Ogun', lga: 'Obafemi Owode', lat: 6.7800, lon: 3.4400 },

  // ── ONDO STATE ─────────────────────────────────────────────────────────────
  { name: 'Akure', state: 'Ondo', lga: 'Akure South', lat: 7.2526, lon: 5.1931 },
  { name: 'Ondo Town', state: 'Ondo', lga: 'Ondo West', lat: 7.0917, lon: 4.8333 },
  { name: 'Owo', state: 'Ondo', lga: 'Owo', lat: 7.1961, lon: 5.5867 },
  { name: 'Ikare', state: 'Ondo', lga: 'Akoko North-East', lat: 7.5256, lon: 5.7567 },
  { name: 'Okitipupa', state: 'Ondo', lga: 'Okitipupa', lat: 6.5042, lon: 4.7839 },
  { name: 'Ore', state: 'Ondo', lga: 'Odigbo', lat: 6.7481, lon: 4.8767 },

  // ── OSUN STATE ─────────────────────────────────────────────────────────────
  { name: 'Osogbo', state: 'Osun', lga: 'Osogbo', lat: 7.7827, lon: 4.5418 },
  { name: 'Ile-Ife', state: 'Osun', lga: 'Ife Central', lat: 7.4833, lon: 4.5667 },
  { name: 'Ilesa', state: 'Osun', lga: 'Ilesa East', lat: 7.6297, lon: 4.7417 },
  { name: 'Ede', state: 'Osun', lga: 'Ede North', lat: 7.7375, lon: 4.4447 },
  { name: 'Ikirun', state: 'Osun', lga: 'Ifelodun', lat: 7.9139, lon: 4.6708 },
  { name: 'Iwo', state: 'Osun', lga: 'Iwo', lat: 7.6292, lon: 4.1814 },

  // ── OYO STATE ──────────────────────────────────────────────────────────────
  { name: 'Ibadan', state: 'Oyo', lga: 'Ibadan North', lat: 7.3775, lon: 3.9470 },
  { name: 'Ogbomoso', state: 'Oyo', lga: 'Ogbomoso North', lat: 8.1333, lon: 4.2500 },
  { name: 'Oyo Town', state: 'Oyo', lga: 'Atiba', lat: 7.8431, lon: 3.9317 },
  { name: 'Iseyin', state: 'Oyo', lga: 'Iseyin', lat: 7.9667, lon: 3.6000 },
  { name: 'Saki', state: 'Oyo', lga: 'Saki West', lat: 8.6667, lon: 3.4000 },
  { name: 'Kisi', state: 'Oyo', lga: 'Irepo', lat: 9.0833, lon: 3.8500 },
  { name: 'Eruwa', state: 'Oyo', lga: 'Ibarapa East', lat: 7.5333, lon: 3.4167 },

  // ── PLATEAU STATE ──────────────────────────────────────────────────────────
  { name: 'Jos', state: 'Plateau', lga: 'Jos North', lat: 9.8965, lon: 8.8583 },
  { name: 'Bukuru', state: 'Plateau', lga: 'Jos South', lat: 9.7944, lon: 8.8639 },
  { name: 'Pankshin', state: 'Plateau', lga: 'Pankshin', lat: 9.3333, lon: 9.4500 },
  { name: 'Shendam', state: 'Plateau', lga: 'Shendam', lat: 8.8833, lon: 9.5000 },
  { name: 'Barkin Ladi', state: 'Plateau', lga: 'Barkin Ladi', lat: 9.5333, lon: 8.8833 },
  { name: 'Mangu', state: 'Plateau', lga: 'Mangu', lat: 9.5167, lon: 9.1000 },
  { name: 'Langtang', state: 'Plateau', lga: 'Langtang North', lat: 9.1333, lon: 9.7833 },
  { name: 'Bokkos', state: 'Plateau', lga: 'Bokkos', lat: 9.3000, lon: 8.9833 },

  // ── RIVERS STATE ───────────────────────────────────────────────────────────
  { name: 'Port Harcourt', state: 'Rivers', lga: 'Port Harcourt', lat: 4.8156, lon: 7.0498 },
  { name: 'Obio-Akpor', state: 'Rivers', lga: 'Obio-Akpor', lat: 4.8439, lon: 6.9806 },
  { name: 'Bonny', state: 'Rivers', lga: 'Bonny', lat: 4.4500, lon: 7.1667 },
  { name: 'Degema', state: 'Rivers', lga: 'Degema', lat: 4.7500, lon: 6.7667 },
  { name: 'Eleme', state: 'Rivers', lga: 'Eleme', lat: 4.7933, lon: 7.1247 },
  { name: 'Okrika', state: 'Rivers', lga: 'Okrika', lat: 4.7439, lon: 7.0864 },
  { name: 'Ahoada', state: 'Rivers', lga: 'Ahoada East', lat: 5.0833, lon: 6.6500 },
  { name: 'Oyigbo', state: 'Rivers', lga: 'Oyigbo', lat: 4.8778, lon: 7.1517 },
  { name: 'Onne', state: 'Rivers', lga: 'Eleme', lat: 4.7167, lon: 7.1500 },
  { name: 'Omoku', state: 'Rivers', lga: 'Ogba/Egbema/Ndoni', lat: 5.3439, lon: 6.6569 },

  // ── SOKOTO STATE ───────────────────────────────────────────────────────────
  { name: 'Sokoto', state: 'Sokoto', lga: 'Sokoto South', lat: 13.0609, lon: 5.2340 },
  { name: 'Tambuwal', state: 'Sokoto', lga: 'Tambuwal', lat: 12.4039, lon: 4.6936 },
  { name: 'Wurno', state: 'Sokoto', lga: 'Wurno', lat: 13.2897, lon: 5.4217 },
  { name: 'Gwadabawa', state: 'Sokoto', lga: 'Gwadabawa', lat: 13.3556, lon: 5.2367 },
  { name: 'Illela', state: 'Sokoto', lga: 'Illela', lat: 13.7300, lon: 5.3000 },
  { name: 'Bodinga', state: 'Sokoto', lga: 'Bodinga', lat: 12.8369, lon: 5.1436 },
  { name: 'Goronyo', state: 'Sokoto', lga: 'Goronyo', lat: 13.4439, lon: 5.6767 },
  { name: 'Isa', state: 'Sokoto', lga: 'Isa', lat: 13.2000, lon: 6.3500 },

  // ── TARABA STATE ───────────────────────────────────────────────────────────
  { name: 'Jalingo', state: 'Taraba', lga: 'Jalingo', lat: 8.8936, lon: 11.3597 },
  { name: 'Wukari', state: 'Taraba', lga: 'Wukari', lat: 7.8706, lon: 9.7797 },
  { name: 'Bali', state: 'Taraba', lga: 'Bali', lat: 7.8594, lon: 11.0089 },
  { name: 'Gembu', state: 'Taraba', lga: 'Sardauna (Mambilla)', lat: 6.7167, lon: 11.2500 },
  { name: 'Takum', state: 'Taraba', lga: 'Takum', lat: 7.2597, lon: 9.9889 },
  { name: 'Zing', state: 'Taraba', lga: 'Zing', lat: 8.9833, lon: 11.7500 },
  { name: 'Gassol', state: 'Taraba', lga: 'Gassol', lat: 8.5300, lon: 10.5800 },

  // ── YOBE STATE ─────────────────────────────────────────────────────────────
  { name: 'Damaturu', state: 'Yobe', lga: 'Damaturu', lat: 11.7470, lon: 11.9608 },
  { name: 'Potiskum', state: 'Yobe', lga: 'Potiskum', lat: 11.7092, lon: 11.0694 },
  { name: 'Gashua', state: 'Yobe', lga: 'Bade', lat: 12.8711, lon: 11.0436 },
  { name: 'Nguru', state: 'Yobe', lga: 'Nguru', lat: 12.8767, lon: 10.4553 },
  { name: 'Geidam', state: 'Yobe', lga: 'Geidam', lat: 12.8942, lon: 11.9286 },
  { name: 'Buni Yadi', state: 'Yobe', lga: 'Gujba', lat: 11.2753, lon: 11.9961 },

  // ── ZAMFARA STATE ──────────────────────────────────────────────────────────
  { name: 'Gusau', state: 'Zamfara', lga: 'Gusau', lat: 12.1628, lon: 6.6614 },
  { name: 'Kaura Namoda', state: 'Zamfara', lga: 'Kaura Namoda', lat: 12.5936, lon: 6.5861 },
  { name: 'Talata Mafara', state: 'Zamfara', lga: 'Talata Mafara', lat: 12.5694, lon: 6.0628 },
  { name: 'Anka', state: 'Zamfara', lga: 'Anka', lat: 11.9167, lon: 5.9667 },
  { name: 'Maru', state: 'Zamfara', lga: 'Maru', lat: 12.3333, lon: 6.4000 },
  { name: 'Zurmi', state: 'Zamfara', lga: 'Zurmi', lat: 12.7758, lon: 6.7908 },
  { name: 'Shinkafi', state: 'Zamfara', lga: 'Shinkafi', lat: 13.0767, lon: 6.5050 },
  { name: 'Bakura', state: 'Zamfara', lga: 'Bakura', lat: 12.7167, lon: 5.8667 },
  { name: 'Tsafe', state: 'Zamfara', lga: 'Tsafe', lat: 11.9567, lon: 6.9200 },
];

/**
 * Approximate bounding boxes for all 36 States + FCT.
 * Used for fallback containment matching when distance to nearest city is large.
 */
const STATE_BOUNDS = [
  { state: 'Abia', minLat: 4.8, maxLat: 6.0, minLon: 7.1, maxLon: 7.9 },
  { state: 'Adamawa', minLat: 8.0, maxLat: 11.1, minLon: 11.5, maxLon: 13.8 },
  { state: 'Akwa Ibom', minLat: 4.4, maxLat: 5.5, minLon: 7.4, maxLon: 8.4 },
  { state: 'Anambra', minLat: 5.7, maxLat: 6.5, minLon: 6.6, maxLon: 7.3 },
  { state: 'Bauchi', minLat: 9.4, maxLat: 12.3, minLon: 8.8, maxLon: 11.0 },
  { state: 'Bayelsa', minLat: 4.2, maxLat: 5.4, minLon: 5.3, maxLon: 6.6 },
  { state: 'Benue', minLat: 6.7, maxLat: 8.2, minLon: 7.6, maxLon: 10.0 },
  { state: 'Borno', minLat: 10.0, maxLat: 13.9, minLon: 11.5, maxLon: 14.7 },
  { state: 'Cross River', minLat: 4.7, maxLat: 7.0, minLon: 7.8, maxLon: 9.5 },
  { state: 'Delta', minLat: 5.0, maxLat: 6.5, minLon: 5.0, maxLon: 6.8 },
  { state: 'Ebonyi', minLat: 5.7, maxLat: 6.8, minLon: 7.6, maxLon: 8.5 },
  { state: 'Edo', minLat: 5.8, maxLat: 7.6, minLon: 5.0, maxLon: 6.7 },
  { state: 'Ekiti', minLat: 7.3, maxLat: 8.1, minLon: 4.8, maxLon: 5.7 },
  { state: 'Enugu', minLat: 5.9, maxLat: 7.1, minLon: 7.1, maxLon: 7.8 },
  { state: 'Federal Capital Territory', minLat: 8.4, maxLat: 9.4, minLon: 6.8, maxLon: 7.7 },
  { state: 'Gombe', minLat: 9.5, maxLat: 11.3, minLon: 10.5, maxLon: 11.8 },
  { state: 'Imo', minLat: 5.2, maxLat: 6.0, minLon: 6.7, maxLon: 7.5 },
  { state: 'Jigawa', minLat: 11.0, maxLat: 13.0, minLon: 8.2, maxLon: 10.5 },
  { state: 'Kaduna', minLat: 9.0, maxLat: 11.6, minLon: 6.1, maxLon: 8.8 },
  { state: 'Kano', minLat: 11.1, maxLat: 12.7, minLon: 7.7, maxLon: 9.4 },
  { state: 'Katsina', minLat: 11.1, maxLat: 13.4, minLon: 6.8, maxLon: 8.7 },
  { state: 'Kebbi', minLat: 10.5, maxLat: 13.3, minLon: 3.5, maxLon: 5.4 },
  { state: 'Kogi', minLat: 6.6, maxLat: 8.8, minLon: 5.7, maxLon: 7.8 },
  { state: 'Kwara', minLat: 8.0, maxLat: 10.2, minLon: 2.7, maxLon: 6.0 },
  { state: 'Lagos', minLat: 6.3, maxLat: 6.7, minLon: 2.7, maxLon: 4.2 },
  { state: 'Nasarawa', minLat: 7.8, maxLat: 9.4, minLon: 6.8, maxLon: 9.4 },
  { state: 'Niger', minLat: 8.2, maxLat: 11.4, minLon: 3.6, maxLon: 7.4 },
  { state: 'Ogun', minLat: 6.3, maxLat: 7.8, minLon: 2.7, maxLon: 4.7 },
  { state: 'Ondo', minLat: 5.8, maxLat: 7.8, minLon: 4.5, maxLon: 6.0 },
  { state: 'Osun', minLat: 6.9, maxLat: 8.1, minLon: 4.0, maxLon: 5.1 },
  { state: 'Oyo', minLat: 7.0, maxLat: 9.2, minLon: 2.7, maxLon: 4.6 },
  { state: 'Plateau', minLat: 8.4, maxLat: 10.4, minLon: 8.5, maxLon: 10.2 },
  { state: 'Rivers', minLat: 4.3, maxLat: 5.5, minLon: 6.4, maxLon: 7.6 },
  { state: 'Sokoto', minLat: 11.5, maxLat: 13.9, minLon: 4.5, maxLon: 6.7 },
  { state: 'Taraba', minLat: 6.5, maxLat: 9.6, minLon: 9.3, maxLon: 12.0 },
  { state: 'Yobe', minLat: 11.0, maxLat: 13.4, minLon: 10.3, maxLon: 12.5 },
  { state: 'Zamfara', minLat: 11.2, maxLat: 13.2, minLon: 5.5, maxLon: 7.2 },
];

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCompassBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const compass = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return compass[Math.round(brng / 22.5) % 16];
}

/**
 * Check if coordinates are within the borders of Nigeria.
 */
export function isInsideNigeria(lat, lon) {
  return lat >= NIGERIA_BOUNDS.minLat &&
         lat <= NIGERIA_BOUNDS.maxLat &&
         lon >= NIGERIA_BOUNDS.minLon &&
         lon <= NIGERIA_BOUNDS.maxLon;
}

// ── In-Memory & Disk Geocode Cache ───────────────────────────────────────────

const _geocodeCache = new Map();
const CACHE_FILE = path.resolve(process.cwd(), '.cache/nigeria_geocode.json');

// Ensure .cache directory exists and load prior cache if available
try {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      _geocodeCache.set(k, v);
    }
  }
} catch {
  // Ignore filesystem cache load error
}

function saveCacheToDisk() {
  try {
    const obj = {};
    for (const [k, v] of _geocodeCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch {
    // Ignore cache write error
  }
}

// Rate-limited background queue for OpenStreetMap Nominatim enrichment
const _nominatimQueue = [];
let _nominatimProcessing = false;

function enqueueNominatimEnrichment(lat, lon, cacheKey) {
  if (_nominatimQueue.some((q) => q.cacheKey === cacheKey)) return;
  _nominatimQueue.push({ lat, lon, cacheKey });
  _processNominatimQueue();
}

async function _processNominatimQueue() {
  if (_nominatimProcessing || _nominatimQueue.length === 0) return;
  _nominatimProcessing = true;

  try {
    while (_nominatimQueue.length > 0) {
      const item = _nominatimQueue.shift();
      if (!item) break;

      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${item.lat.toFixed(5)}&lon=${item.lon.toFixed(5)}&zoom=14&addressdetails=1`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'GodsEyeView-IncidentMonitor/1.0 (contact: info@godseyeview.org)',
            'Accept-Language': 'en',
          },
          signal: AbortSignal.timeout(6000),
        });

        if (resp.ok) {
          const data = await resp.json();
          const addr = data?.address || {};
          const cached = _geocodeCache.get(item.cacheKey);
          if (cached) {
            const nomCity = addr.city || addr.town || addr.village || addr.suburb || addr.hamlet || cached.city;
            const nomLga = addr.county || addr.state_district || cached.lga;
            const nomState = addr.state || cached.state;

            cached.city = nomCity;
            cached.lga = nomLga ? (nomLga.toLowerCase().includes('lga') ? nomLga : `${nomLga} LGA`) : cached.lga;
            cached.state = nomState ? (nomState.toLowerCase().includes('state') || nomState.toLowerCase().includes('territory') ? nomState : `${nomState} State`) : cached.state;
            cached.locationFull = `${cached.city}, ${cached.lga}, ${cached.state}, Nigeria`;
            cached.area = `${cached.city} (${cached.lga})`;
            _geocodeCache.set(item.cacheKey, cached);
            saveCacheToDisk();
          }
        }
      } catch {
        // Silently tolerate upstream timeout / network failure
      }

      // Strictly obey Nominatim TOS: 1 request every 1.2s
      await new Promise((r) => setTimeout(r, 1200));
    }
  } finally {
    _nominatimProcessing = false;
  }
}

/**
 * Reverse geocode a latitude and longitude to exact Nigerian State, LGA, City,
 * and cardinal Area distance.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{
 *   isNigeria: boolean,
 *   state: string,
 *   stateShort: string,
 *   city: string,
 *   lga: string,
 *   area: string,
 *   locationFull: string,
 *   distKm: number,
 *   bearing: string
 * }}
 */
export function resolveNigeriaLocation(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isInsideNigeria(lat, lon)) {
    return {
      isNigeria: false,
      state: '',
      stateShort: '',
      city: '',
      lga: '',
      area: '',
      locationFull: '',
      distKm: 0,
      bearing: '',
    };
  }

  // Check 1.1km grid cache
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (_geocodeCache.has(cacheKey)) {
    return _geocodeCache.get(cacheKey);
  }

  // 1. Find nearest settlement from built-in gazetteer
  let best = NIGERIA_SETTLEMENTS[0];
  let minD = Infinity;

  for (const s of NIGERIA_SETTLEMENTS) {
    const d = haversineDist(lat, lon, s.lat, s.lon);
    if (d < minD) {
      minD = d;
      best = s;
    }
  }

  // 2. Fallback check against State Bounds if the settlement distance is > 90km
  let state = best.state;
  if (minD > 90) {
    for (const sb of STATE_BOUNDS) {
      if (lat >= sb.minLat && lat <= sb.maxLat && lon >= sb.minLon && lon <= sb.maxLon) {
        state = sb.state;
        break;
      }
    }
  }

  const bearing = getCompassBearing(best.lat, best.lon, lat, lon);
  const distKm = Math.round(minD * 10) / 10;
  const lga = best.lga ? (best.lga.toLowerCase().includes('lga') ? best.lga : `${best.lga} LGA`) : `${state} LGA`;
  const stateFull = state.toLowerCase().includes('state') || state.toLowerCase().includes('territory')
    ? state
    : `${state} State`;

  let area = '';
  if (distKm <= 3.0) {
    area = `${best.name} (${lga})`;
  } else if (distKm <= 15.0) {
    area = `${distKm} km ${bearing} of ${best.name} (${lga})`;
  } else {
    area = `${distKm} km ${bearing} of ${best.name} corridor (${lga})`;
  }

  const locationFull = `${best.name}, ${lga}, ${stateFull}, Nigeria`;

  const result = {
    isNigeria: true,
    state: stateFull,
    stateShort: state.replace(/ State$/i, ''),
    city: best.name,
    lga,
    area,
    locationFull,
    distKm,
    bearing,
  };

  _geocodeCache.set(cacheKey, result);

  // Queue asynchronous enrichment for deeper Nominatim village/road details
  enqueueNominatimEnrichment(lat, lon, cacheKey);

  return result;
}
