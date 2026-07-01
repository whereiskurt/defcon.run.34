# run.flash

Meshtastic firmware flasher for DEF CON 34 (`flash.defcon.run`). Offline at
event time — firmware binaries and the hardware list are vendored into the
Docker image at build.

## Release verification checklist

Run these after building the image for a release and before promoting.

### Offline guarantee (DPLY-06)

The flasher must never call the Meshtastic API at runtime. Grep the built
output for the upstream hosts (api.meshtastic.org and github.com/meshtastic)
— no matches expected.

```sh
# From apps/run.flash/webapp after `next build`:
grep -rE 'api\.meshtastic\.org|github\.com/meshtastic' .next/standalone .next/static
```

Any hit is a release blocker. Investigate the file that matched; a runtime
fetch means the offline invariant has regressed.

### Hardware boot test (FLSH-08)

The `.factory.bin` blob at `0x00` must actually boot the device — a passing
`next build` does not prove this. Flash one device from each ESP32 family in
the Recommended set end-to-end from the built image and confirm it boots and
joins the Meshtastic UI.

Recommended devices come from `RECOMMENDED_SLUGS` in
`webapp/src/config/devices.ts` (authoritative list). At minimum, verify one
`HELTEC_V3`, one `TBEAM`, and one `RAK4631` before promoting a release.
