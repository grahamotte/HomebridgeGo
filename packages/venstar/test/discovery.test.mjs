import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeHost, parseSsdpResponse, serialNumber } from "../dist/discovery.js";

describe("Venstar discovery", () => {
  it("uses the Venstar MAC address from SSDP USNs as the serial number", () => {
    const usn = "colortouch:ecp:00:9D:6B:A0:67:6B:name:PRIMARY LIVIN:type:residential";
    assert.equal(serialNumber(`ssdp:${usn}`, usn), "00:9D:6B:A0:67:6B");
  });

  it("keeps short manual host IDs as the serial number", () => {
    assert.equal(serialNumber("host:192.168.1.218"), "host:192.168.1.218");
  });

  it("limits fallback serial numbers to HomeKit's maximum length", () => {
    const serial = serialNumber("ssdp:colortouch:ecp:no-mac-address:name:VERY LONG THERMOSTAT NAME:type:residential");
    assert.equal(serial, "ssdp:colortouch:ecp:no-mac-address:name:VERY LONG THERMOSTAT NAM");
  });

  it("parses SSDP responses", () => {
    const response = Buffer.from("HTTP/1.1 200 OK\r\nLocation: http://192.168.1.218/\r\nUSN: colortouch:ecp:x\r\n\r\n");
    assert.deepEqual(parseSsdpResponse(response), { location: "http://192.168.1.218/", usn: "colortouch:ecp:x" });
    assert.equal(parseSsdpResponse(Buffer.from("HTTP/1.1 200 OK\r\n\r\n")), undefined);
  });

  it("normalizes configured hosts", () => {
    assert.equal(normalizeHost(" http://192.168.1.218/query "), "192.168.1.218");
    assert.equal(normalizeHost("thermostat.local:8080"), "thermostat.local:8080");
  });
});
