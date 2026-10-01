// The tracker ships no types; this covers the part the tests use.
declare module 'bittorrent-tracker/server' {
  import type { Server as HttpServer } from 'node:http';
  export default class Server {
    constructor(opts: { udp?: boolean; http?: boolean; ws?: boolean; stats?: boolean });
    http: HttpServer | null;
    listen(port: number, hostname: string, onListening: () => void): void;
    close(cb?: () => void): void;
  }
}
