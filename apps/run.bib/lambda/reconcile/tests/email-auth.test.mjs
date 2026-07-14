import { describe, it, expect } from "vitest";

/**
 * DMARC gate — read the verdict Amazon SES stamps into the message's
 * Authentication-Results header. SES is the receiving MTA and prepends this
 * header ABOVE anything in the original message, so the topmost
 * Authentication-Results is SES's; an attacker's forged copy sits below it and
 * is ignored. Fail-closed when SES stamped no verdict.
 */

import { sesDmarcResult, isDmarcPass } from "../lib/email-auth.mjs";

// A realistic SES-received header block (folded, multi-line), like the real
// forwarded receipt: SES authserv-id, spf/dkim/dmarc all pass.
function sesEmail({ dmarc = "pass", from = "defcon.run@gmail.com" } = {}) {
  return [
    "Return-Path: <" + from + ">",
    "Received: from mail-yw1-f180.google.com (mail-yw1-f180.google.com [209.85.128.180])",
    " by inbound-smtp.us-east-1.amazonaws.com with SMTP id abc123",
    " for bibpayment@run.defcon.run;",
    " Tue, 14 Jul 2026 21:29:20 +0000 (UTC)",
    "Authentication-Results: amazonses.com;",
    " spf=pass (spfCheck: domain of _spf.google.com designates 209.85.128.180 as permitted sender) client-ip=209.85.128.180;",
    " dkim=pass header.i=@gmail.com;",
    " dmarc=" + dmarc + " header.from=gmail.com;",
    "From: Defcon Run <" + from + ">",
    "Subject: Fwd: You received a payment on Venmo",
    "",
    "body here",
    "",
  ].join("\r\n");
}

describe("sesDmarcResult()", () => {
  it("reads dmarc=pass from the SES Authentication-Results header (folded)", () => {
    expect(sesDmarcResult(sesEmail({ dmarc: "pass" }))).toBe("pass");
  });

  it("reads dmarc=fail", () => {
    expect(sesDmarcResult(sesEmail({ dmarc: "fail" }))).toBe("fail");
  });

  it("accepts a Buffer as well as a string", () => {
    expect(sesDmarcResult(Buffer.from(sesEmail({ dmarc: "pass" })))).toBe("pass");
  });

  it("returns null when there is no Authentication-Results header (fail-closed)", () => {
    const raw = "From: x@gmail.com\r\nSubject: t\r\n\r\nbody\r\n";
    expect(sesDmarcResult(raw)).toBeNull();
  });

  it("does NOT trust a topmost Authentication-Results from a non-SES authserv-id", () => {
    // Attacker forges their own A-R header. Its authserv-id isn't amazonses.com,
    // so we refuse to read a verdict from it.
    const raw = [
      "Authentication-Results: attacker.example; dmarc=pass header.from=gmail.com;",
      "From: Kurt <whereiskurt@gmail.com>",
      "",
      "body",
    ].join("\r\n");
    expect(sesDmarcResult(raw)).toBeNull();
  });

  it("only reads the TOPMOST (SES) A-R, ignoring a forged amazonses copy below it", () => {
    // SES's real verdict (fail) is topmost; an attacker-embedded amazonses.com
    // header claiming pass sits below and must be ignored.
    const raw = [
      "Authentication-Results: amazonses.com; dmarc=fail header.from=gmail.com;",
      "Received: from somewhere",
      "Authentication-Results: amazonses.com; dmarc=pass header.from=gmail.com;",
      "From: Kurt <whereiskurt@gmail.com>",
      "",
      "body",
    ].join("\r\n");
    expect(sesDmarcResult(raw)).toBe("fail");
  });
});

describe("isDmarcPass()", () => {
  it("true only when SES stamped dmarc=pass", () => {
    expect(isDmarcPass(sesEmail({ dmarc: "pass" }))).toBe(true);
  });
  it("false on dmarc=fail", () => {
    expect(isDmarcPass(sesEmail({ dmarc: "fail" }))).toBe(false);
  });
  it("false when SES stamped no verdict (fail-closed)", () => {
    expect(isDmarcPass("From: x@gmail.com\r\n\r\nbody")).toBe(false);
  });
});
