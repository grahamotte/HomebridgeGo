# Go Venstar

Homebridge plugin for Venstar thermostats. It talks to each thermostat directly over the
[Venstar local API](https://developer.venstar.com/documentation/), with no Skyport cloud account.

## Features

- Discovers thermostats with SSDP, and looks again every five minutes for new or moved ones.
- Exposes thermostat mode, current temperature, target temperature, heat and cool thresholds,
  display units, and the fan setting.
- Answers HomeKit reads from the last known state and refreshes in the background, so a slow
  thermostat does not stall the Home app.
- Keeps thermostats in HomeKit while they are offline.

## Requirements

- Venstar thermostats on Wi-Fi, on the same network as Homebridge.
- Local API access turned on for each thermostat. On many models it is in the thermostat's Wi-Fi settings.

## Setup

Add the platform. There are no required settings.

```json
{
  "platform": "GoVenstar"
}
```

## Options

- `hosts`: optional thermostat addresses, for thermostats SSDP discovery cannot reach, such as ones on
  another subnet. They are used alongside discovery.

## Troubleshooting

- If no thermostat is found, the log says so once. Check that local API access is on, or set `hosts`.
- A thermostat that goes offline is logged once, with its recovery; retries are logged at debug level.
- Thermostats are never removed automatically. Remove one you no longer have from the Homebridge UI's
  cached accessories.

## Notes

Thermostat requests time out after 15 seconds and SSDP discovery listens for 10 seconds, because
thermostats can be slow to answer on busy Wi-Fi.
