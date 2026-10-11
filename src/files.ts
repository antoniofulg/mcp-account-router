import {
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve, parse, join } from "node:path";
import { randomBytes } from "node:crypto";

export function noSymlinks(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const component of absolute.slice(current.length).split(/[\\/]/)) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Symlinked private path rejected");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export function privateDir(path: string): void {
  noSymlinks(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.mode & 0o077)
    throw new Error("Private directory must have mode 0700");
}
export function readPrivate(path: string): string | null {
  noSymlinks(path);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077) throw new Error("Private file must have mode 0600");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
export function writePrivate(path: string, value: unknown): void {
  privateDir(dirname(path));
  if (readPrivate(path) !== null) noSymlinks(path);
  const temporary = join(dirname(path), `.${randomBytes(16).toString("hex")}.tmp`);
  const fd = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    noSymlinks(path);
    renameSync(temporary, path);
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}
