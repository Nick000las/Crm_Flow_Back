/** Aceita localhost tanto em IPv4 quanto em IPv6 no desenvolvimento local. */
export function listenOptions(config) {
  if (config.NODE_ENV === 'development' && config.HOST === '0.0.0.0') {
    return { port: config.PORT, host: '::', ipv6Only: false };
  }
  return { port: config.PORT, host: config.HOST };
}
