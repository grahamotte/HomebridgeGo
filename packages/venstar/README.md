# Go Venstar

Homebridge plugin for local Venstar thermostats using the
[Venstar local API](https://developer.venstar.com/documentation/).

## Features

- Discovers Venstar thermostats with SSDP.
- Keeps cached HomeKit accessories when a thermostat is temporarily offline.
- Answers HomeKit reads from cached state and refreshes in the background, so a slow thermostat does not stall the Home app.
- Exposes thermostat mode, current temperature, target temperature, heat/cool thresholds, display units, and fan setting.

## Requirements

- Homebridge 1.8 or newer.
- Node.js 20+.
- Venstar thermostats connected to Wi-Fi.
- Local API access enabled on each thermostat.
- Homebridge running on the same local network as the thermostats.

## Setup

1. Connect each Venstar thermostat to Wi-Fi.
2. Enable local API access on each thermostat. On many Venstar models this is under the thermostat's Wi-Fi settings.
3. Make sure Homebridge is running on the same local network as the thermostats.
4. Install the plugin through Homebridge UI or with:

   ```sh
   npm install -g homebridge-go-venstar
   ```

5. Add the `GoVenstar` platform in Homebridge.

There are no settings. The plugin discovers local Venstar thermostats with SSDP, so the platform entry is all you need:

```json
{
  "platform": "GoVenstar"
}
```

Thermostat requests time out after 15 seconds and SSDP discovery listens for 10 seconds.

## Troubleshooting

If a thermostat is missing, check that local API access is enabled and that it is on the same network as Homebridge.
A thermostat that misses discovery after it has been added stays in HomeKit from cache.
