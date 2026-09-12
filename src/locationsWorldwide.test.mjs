import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CITY_POIS,
  LOCATIONS,
  findPoiByName,
  tryParseCoordinates,
  searchAndFlyTo,
} from './locations.js';
import {
  osmToGeocodeTypes,
  projectOsmNominatimResult,
} from '../server/providers/places/geocode.js';

test('CITY_POIS includes Nigeria, Lagos, and Abuja with complete metadata', () => {
  for (const cityId of ['nigeria', 'lagos', 'abuja']) {
    const city = CITY_POIS[cityId];
    assert.ok(city, `Expected ${cityId} to be present in CITY_POIS`);
    assert.ok(typeof city.name === 'string' && city.name.length > 0);
    assert.ok(Number.isFinite(city.groundElevation), 'groundElevation must be finite');
    assert.ok(city.viewBounds, 'viewBounds must be defined');
    assert.ok(Number.isFinite(city.viewBounds.southwest.lat));
    assert.ok(Number.isFinite(city.viewBounds.southwest.lng));
    assert.ok(Number.isFinite(city.viewBounds.northeast.lat));
    assert.ok(Number.isFinite(city.viewBounds.northeast.lng));

    assert.equal(city.pois.length, 5, `Expected 5 POIs for ${cityId}`);
    for (const poi of city.pois) {
      assert.ok(typeof poi.name === 'string' && poi.name.length > 0);
      assert.ok(Number.isFinite(poi.lat) && poi.lat >= -90 && poi.lat <= 90);
      assert.ok(Number.isFinite(poi.lon) && poi.lon >= -180 && poi.lon <= 180);
      assert.ok(Number.isFinite(poi.alt) && poi.alt > 0);
      assert.ok(Number.isFinite(poi.pitch) && poi.pitch <= 0);
      assert.ok(Number.isFinite(poi.heading));
    }
  }

  // Verify LOCATIONS contains the new cities
  const ids = new Set(LOCATIONS.map((loc) => loc.id));
  assert.ok(ids.has('nigeria'));
  assert.ok(ids.has('lagos'));
  assert.ok(ids.has('abuja'));
});

test('findPoiByName matches Nigerian landmarks', () => {
  const zuma = findPoiByName('Zuma Rock');
  assert.ok(zuma, 'Should find Zuma Rock');
  assert.ok(CITY_POIS[zuma.cityId].pois[zuma.index].name.includes('Zuma Rock'));

  const lekki = findPoiByName('Lekki-Ikoyi Link Bridge');
  assert.ok(lekki, 'Should find Lekki-Ikoyi Link Bridge');
  assert.ok(CITY_POIS[lekki.cityId].pois[lekki.index].name.includes('Lekki-Ikoyi Link Bridge'));

  const aso = findPoiByName('Aso Rock');
  assert.ok(aso, 'Should find Aso Rock');
  assert.ok(CITY_POIS[aso.cityId].pois[aso.index].name.includes('Aso Rock'));
});

test('tryParseCoordinates parses latitude and longitude formats', () => {
  // Standard comma-separated decimal
  const c1 = tryParseCoordinates('9.0765, 7.3986');
  assert.ok(c1);
  assert.ok(Math.abs(c1.lat - 9.0765) < 1e-4);
  assert.ok(Math.abs(c1.lon - 7.3986) < 1e-4);

  // Space-separated
  const c2 = tryParseCoordinates('6.5244 3.3792');
  assert.ok(c2);
  assert.ok(Math.abs(c2.lat - 6.5244) < 1e-4);
  assert.ok(Math.abs(c2.lon - 3.3792) < 1e-4);

  // With directional hemispheres (N, S, E, W)
  const c3 = tryParseCoordinates('9.0765 N, 7.3986 E');
  assert.ok(c3);
  assert.ok(Math.abs(c3.lat - 9.0765) < 1e-4);
  assert.ok(Math.abs(c3.lon - 7.3986) < 1e-4);

  const c4 = tryParseCoordinates('33.8688 S, 151.2093 E');
  assert.ok(c4);
  assert.ok(Math.abs(c4.lat - (-33.8688)) < 1e-4);
  assert.ok(Math.abs(c4.lon - 151.2093) < 1e-4);

  // Non-coordinates return null
  assert.equal(tryParseCoordinates('Lagos Nigeria'), null);
  assert.equal(tryParseCoordinates('Austin'), null);
  assert.equal(tryParseCoordinates(''), null);
  assert.equal(tryParseCoordinates(null), null);
});

test('osmToGeocodeTypes classifies OpenStreetMap features properly', () => {
  assert.deepEqual(osmToGeocodeTypes({ addresstype: 'country' }), ['country', 'political']);
  assert.deepEqual(osmToGeocodeTypes({ addresstype: 'city' }), ['locality', 'political']);
  assert.deepEqual(osmToGeocodeTypes({ addresstype: 'state' }), ['administrative_area_level_1', 'political']);
  assert.deepEqual(osmToGeocodeTypes({ class: 'natural', type: 'peak' }), ['natural_feature', 'establishment']);
  assert.deepEqual(osmToGeocodeTypes({ class: 'historic', type: 'monument' }), ['tourist_attraction', 'point_of_interest', 'establishment']);
});

test('projectOsmNominatimResult builds standard geocode response structure', () => {
  const osmSample = {
    place_id: 42583238,
    lat: '9.6000359',
    lon: '7.9999721',
    class: 'boundary',
    type: 'administrative',
    addresstype: 'country',
    name: 'Nigeria',
    display_name: 'Nigeria',
    boundingbox: ['4.0690959', '13.8856450', '2.6769320', '14.6780140'],
  };

  const projected = projectOsmNominatimResult(osmSample);
  assert.ok(projected);
  assert.equal(projected.formatted_address, 'Nigeria');
  assert.ok(Math.abs(projected.geometry.location.lat - 9.6000359) < 1e-5);
  assert.ok(Math.abs(projected.geometry.location.lng - 7.9999721) < 1e-5);
  assert.deepEqual(projected.types, ['country', 'political']);
  assert.ok(projected.geometry.viewport);
  assert.ok(Math.abs(projected.geometry.viewport.southwest.lat - 4.0690959) < 1e-5);
  assert.ok(Math.abs(projected.geometry.viewport.southwest.lng - 2.6769320) < 1e-5);
  assert.ok(Math.abs(projected.geometry.viewport.northeast.lat - 13.8856450) < 1e-5);
  assert.ok(Math.abs(projected.geometry.viewport.northeast.lng - 14.6780140) < 1e-5);
});
