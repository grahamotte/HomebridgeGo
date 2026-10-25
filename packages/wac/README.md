# Go WAC Fans

Homebridge plugin for WAC and Modern Forms fans. It talks to each fan directly over the local
`POST /mf` API, with no cloud account.

## Features

- Discovers fans with Bonjour, and looks again every five minutes for new or moved ones.
- Exposes fan power, six speed levels, direction, light power, and brightness.
- Answers HomeKit reads from the last known state and refreshes in the background, so a slow fan
  does not stall the Home app.
- Keeps fans in HomeKit while they are switched off at the wall.

## Requirements

- WAC or Modern Forms fans on Wi-Fi, on the same network as Homebridge.

## Setup

Add the platform. There are no required settings.

```json
{
  "platform": "GoWacFans"
}
```

## Options

- `hosts`: optional fan addresses, for fans Bonjour discovery cannot reach, such as ones on another
  subnet. They are used alongside discovery.

## Troubleshooting

- If no fan is found, the log says so once. Set `hosts` if the fans are on another network.
- When a known fan cannot be found, or none is known yet, the plugin probes every address on the local
  networks, at most once every 30 minutes.
- A fan that goes offline is logged once, with its recovery; retries are logged at debug level.
- Fans are never removed automatically. Remove one you no longer have from the Homebridge UI's cached
  accessories.

## Notes

Requests to a fan time out after 15 seconds, because some fans take a few seconds to wake their Wi-Fi
after idling.
