import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const coreRoutes = require("../routes/core.js");
const { buildTrustedWeatherAlert, isSevereOfficialForecast } = coreRoutes._internals;

function twoHourForecast(forecasts) {
  return {
    items: [{
      update_timestamp: "2026-05-01T20:06:33+08:00",
      valid_period: { start: "2026-05-01T20:00:00+08:00", end: "2026-05-01T22:00:00+08:00" },
      forecasts,
    }],
  };
}

function twentyFourForecast(generalForecast = "Thundery Showers", periods = []) {
  return {
    items: [{
      update_timestamp: "2026-05-01T18:29:57+08:00",
      valid_period: { start: "2026-05-01T18:30:00+08:00", end: "2026-05-02T18:30:00+08:00" },
      general: { forecast: generalForecast },
      periods,
    }],
  };
}

describe("trusted weather disaster alert", () => {
  it("stays inactive for ordinary official weather forecasts", () => {
    const result = buildTrustedWeatherAlert({
      checkedAt: "2026-05-01T12:00:00.000Z",
      twoHour: twoHourForecast([
        { area: "City", forecast: "Cloudy" },
        { area: "Orchard", forecast: "Thundery Showers" },
      ]),
      twentyFour: twentyFourForecast("Thundery Showers"),
    });

    expect(result.active).toBe(false);
    expect(result.message).toMatch(/No severe official Singapore weather advisory/);
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://api.data.gov.sg/v1/environment/2-hour-weather-forecast" }),
    ]));
  });

  it("creates an alert only from severe official forecast wording", () => {
    const result = buildTrustedWeatherAlert({
      checkedAt: "2026-05-01T12:00:00.000Z",
      twoHour: twoHourForecast([
        { area: "City", forecast: "Heavy Thundery Showers" },
        { area: "Orchard", forecast: "Heavy Thundery Showers" },
        { area: "Sentosa", forecast: "Cloudy" },
      ]),
      twentyFour: twentyFourForecast("Thundery Showers"),
    });

    expect(result.active).toBe(true);
    expect(result.alert.headline).toContain("Official Weather Advisory");
    expect(result.alert.summary).toContain("Heavy Thundery Showers");
    expect(result.alert.summary).not.toMatch(/typhoon|tsunami|volcanic/i);
    expect(result.alert.sources).toHaveLength(3);
  });

  it("does not treat plain thundery showers as severe", () => {
    expect(isSevereOfficialForecast("Thundery Showers")).toBe(false);
    expect(isSevereOfficialForecast("Heavy Thundery Showers")).toBe(true);
    expect(isSevereOfficialForecast("Thundery Showers with Gusty Winds")).toBe(true);
  });
});