// Minimal types for pngjs, which arrives through vgpu (a direct dependency) rather than
// package.json, so the render script works without changing the lockfile.
declare module "pngjs" {
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: { write(png: PNG): Buffer; read(buffer: Buffer): PNG };
  }
}
