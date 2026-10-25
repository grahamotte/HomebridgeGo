# Go WAC Fans

Homebridge plugin for local WAC and Modern Forms fans using the published local
`POST /mf` API.

## Features

- Discovers fans with WAC/Modern Forms Bonjour plus local API probing.
- Exposes fan power, six speed levels, direction, light power, and brightness.
- Keeps cached accessories when a fan is switched off, and rediscovers fans that come back later.

## Setup

Add the platform. There are no settings; fans on the local network are discovered automatically.

```json
{
  "platform": "GoWacFans"
}
```

Requests to a fan time out after 15 seconds, because some fans take a few seconds to wake their Wi-Fi after
idling. HomeKit reads are answered from the last known state, so a slow fan does not stall the Home app.
