import type { IncomingMessage } from "node:http";

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const LOOPBACK_ADDRESS = /^(?:::ffff:)?127\.0\.0\.1$|^::1$/i;

export function isLoopbackHost(host: string | undefined): boolean {
  return Boolean(host && LOOPBACK_HOST.test(host));
}

export function isLoopbackRequest(request: IncomingMessage): boolean {
  const remoteAddress = request.socket?.remoteAddress;
  return isLoopbackHost(request.headers.host) && (!remoteAddress || LOOPBACK_ADDRESS.test(remoteAddress));
}
