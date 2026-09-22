import { describe, expect, it } from "vitest";
import { isLoopbackHost, isLoopbackRequest } from "./loopback-access";

describe("loopback access policy", () => {
  it("accepts only loopback host names", () => {
    expect(isLoopbackHost("127.0.0.1:5183")).toBe(true);
    expect(isLoopbackHost("localhost:5183")).toBe(true);
    expect(isLoopbackHost("[::1]:5183")).toBe(true);
    expect(isLoopbackHost("0.0.0.0:5183")).toBe(false);
    expect(isLoopbackHost("example.test:5183")).toBe(false);
  });

  it("rejects a non-loopback socket even when the Host header is local", () => {
    const request = {
      headers: { host: "localhost:5183" },
      socket: { remoteAddress: "192.0.2.10" },
    } as never;
    expect(isLoopbackRequest(request)).toBe(false);
  });
});
