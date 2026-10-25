import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCK_STALE_MS, lockPrivateFile, processRuns } from "./lock.js";

let root: string;
let file: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-lock-"));
  file = path.join(root, "cache", "api.json.lock");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const posix = process.platform !== "win32";

/** A process ID that does not run. */
const DEAD_PID = 2147483646;

const HOUR = 3_600_000;

/** The text of a lock file as another start writes it. */
const lockOf = (fields: Record<string, unknown>): string => JSON.stringify({ nonce: "n", ...fields });

/** Write a lock file as another start would, `ageMs` old. */
const writeLock = async (text: string, ageMs = 0): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  const time = new Date(Date.now() - ageMs);
  await fs.utimes(file, time, time);
};

const failure = (code: string): Error => Object.assign(new Error(code), { code });

describe("processRuns", () => {
  it("is true for this process and one of another user, false for none or no process ID", () => {
    expect(processRuns(process.pid)).toBe(true);
    expect(processRuns(DEAD_PID)).toBe(false);
    for (const pid of [0, -1, 1.5, "1", undefined, null]) {
      expect(processRuns(pid)).toBe(false);
    }
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw failure("EPERM");
    });
    expect(processRuns(1)).toBe(true);
  });
});

describe("lockPrivateFile", () => {
  it("takes the lock with mode 0600 in a new 0700 folder, and gives it back", async () => {
    const lock = await lockPrivateFile(file);
    expect(lock?.file).toBe(file);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ pid: process.pid });
    if (posix) {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    }
    await lock?.release();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lock?.release()).resolves.toBeUndefined();
  });

  it("is held while another start has it, also in this process, and free again after release", async () => {
    const first = await lockPrivateFile(file);
    const before = await fs.readFile(file, "utf8");
    expect(await lockPrivateFile(file)).toBeUndefined();
    expect(await fs.readFile(file, "utf8")).toBe(before);
    await first?.release();
    const again = await lockPrivateFile(file);
    expect(again).toBeDefined();
    await again?.release();
  });

  it("gives exactly one of many simultaneous takers the lock", async () => {
    for (let round = 0; round < 20; round++) {
      const locks = await Promise.all(Array.from({ length: 5 }, () => lockPrivateFile(file)));
      const taken = locks.filter((lock) => lock !== undefined);
      expect(taken).toHaveLength(1);
      await taken[0]?.release();
    }
  });

  it("counts a young lock without a process ID (being written) as held", async () => {
    for (const text of ["", "{", "null", '{"pid":"1"}']) {
      await writeLock(text);
      expect(await lockPrivateFile(file)).toBeUndefined();
      expect(await fs.readFile(file, "utf8")).toBe(text);
    }
  });

  it("judges the age by the time in the lock, and by the file time only for a broken lock", async () => {
    // A fresh lock of a running process whose file time is an hour off: held.
    for (const ageMs of [HOUR, -HOUR]) {
      const text = lockOf({ pid: process.pid, created: Date.now() });
      await writeLock(text, ageMs);
      expect(await lockPrivateFile(file)).toBeUndefined();
      expect(await fs.readFile(file, "utf8")).toBe(text);
    }
    // A lock taken an hour ago (or an hour ahead: a clock that went back) with a fresh file time: stale.
    for (const created of [Date.now() - HOUR, Date.now() + HOUR]) {
      await writeLock(lockOf({ pid: process.pid, created }));
      const lock = await lockPrivateFile(file);
      expect(lock).toBeDefined();
      await lock?.release();
    }
  });

  it("breaks a lock whose process does not run, or that is older than LOCK_STALE_MS", async () => {
    const stale = [
      { text: lockOf({ pid: DEAD_PID, created: Date.now() }), ageMs: 0 },
      // Without a time: the file time counts.
      { text: lockOf({ pid: process.pid }), ageMs: LOCK_STALE_MS + 5000 },
      { text: "", ageMs: LOCK_STALE_MS + 5000 },
      { text: "", ageMs: -(LOCK_STALE_MS + 5000) },
    ];
    for (const { text, ageMs } of stale) {
      await writeLock(text, ageMs);
      const lock = await lockPrivateFile(file);
      expect(lock).toBeDefined();
      expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ pid: process.pid });
      expect(await fs.readdir(path.dirname(file))).toEqual(["api.json.lock"]);
      await lock?.release();
    }
  });

  it("gives exactly one of many simultaneous takers a stale lock", async () => {
    for (let round = 0; round < 20; round++) {
      await writeLock(lockOf({ pid: DEAD_PID, created: Date.now() }));
      const locks = await Promise.all(Array.from({ length: 5 }, () => lockPrivateFile(file)));
      const taken = locks.filter((lock) => lock !== undefined);
      expect(taken).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ pid: process.pid });
      await taken[0]?.release();
      expect(await fs.readdir(path.dirname(file))).toEqual([]);
    }
  });

  it("leaves a lock that another start took after this one found the stale one", async () => {
    const fresh = lockOf({ pid: process.pid, created: Date.now(), nonce: "fresh" });
    const replacements: (() => Promise<void>)[] = [
      // Another start broke the stale lock and took it.
      () => fs.writeFile(file, fresh),
      // The same text, written again.
      async () => {
        const time = new Date(Date.now() - 1000);
        await fs.utimes(file, time, time);
      },
    ];
    for (const replace of replacements) {
      await writeLock(lockOf({ pid: DEAD_PID }));
      const before = await fs.readFile(file, "utf8");
      const open = fs.open.bind(fs);
      vi.spyOn(fs, "open")
        .mockImplementationOnce(open)
        .mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
          await replace();
          return open(...args);
        });
      expect(await lockPrivateFile(file)).toBeUndefined();
      expect([fresh, before]).toContain(await fs.readFile(file, "utf8"));
      expect(await fs.readdir(path.dirname(file))).toEqual(["api.json.lock"]);
      vi.restoreAllMocks();
    }
  });

  it("counts the lock as held while another start breaks it, and clears a stale breaker", async () => {
    const breaker = `${file}.break`;
    await writeLock(lockOf({ pid: DEAD_PID }));
    const busy = lockOf({ pid: process.pid, created: Date.now() });
    await fs.writeFile(breaker, busy);
    expect(await lockPrivateFile(file)).toBeUndefined();
    expect(await fs.readFile(breaker, "utf8")).toBe(busy);

    // A breaker that crashed: its file is removed, and the same start then breaks the lock.
    await fs.writeFile(breaker, lockOf({ pid: DEAD_PID }));
    const lock = await lockPrivateFile(file);
    expect(lock).toBeDefined();
    await expect(fs.stat(breaker)).rejects.toMatchObject({ code: "ENOENT" });
    await lock?.release();

    // A crashed breaker's file that another start replaced between the two looks stays.
    await writeLock(lockOf({ pid: DEAD_PID }));
    await fs.writeFile(breaker, lockOf({ pid: DEAD_PID }));
    const replaced = lockOf({ pid: process.pid, created: Date.now(), nonce: "breaker" });
    const readFile = fs.readFile.bind(fs);
    let breakerReads = 0;
    vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      const text = await readFile(...args);
      if (args[0] === breaker && ++breakerReads === 1) {
        await fs.writeFile(breaker, replaced);
      }
      return text;
    });
    expect(await lockPrivateFile(file)).toBeUndefined();
    expect(await readFile(breaker, "utf8")).toBe(replaced);
    vi.restoreAllMocks();
    await fs.rm(breaker);

    // A breaker that finished between the two looks.
    await writeLock(lockOf({ pid: DEAD_PID }));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementationOnce(open).mockRejectedValueOnce(failure("EEXIST"));
    expect(await lockPrivateFile(file)).toBeUndefined();
  });

  it("takes the lock when the stale one is gone at the break, or was given back meanwhile", async () => {
    await writeLock(lockOf({ pid: DEAD_PID }));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open")
      .mockImplementationOnce(open)
      .mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
        await fs.rm(file);
        return open(...args);
      });
    const broken = await lockPrivateFile(file);
    expect(broken).toBeDefined();
    await broken?.release();
    vi.restoreAllMocks();

    await writeLock(lockOf({ pid: process.pid, created: Date.now() }));
    const readFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementationOnce(async () => {
      await fs.rm(file);
      return readFile(file, "utf8");
    });
    const given = await lockPrivateFile(file);
    expect(given).toBeDefined();
    await given?.release();
  });

  it("never removes a lock that another start took after the stale one was broken by a third", async () => {
    await writeLock(lockOf({ pid: DEAD_PID }));
    const fresh = lockOf({ pid: process.pid, created: Date.now(), nonce: "fresh" });
    const open = fs.open.bind(fs);
    const readFile = fs.readFile.bind(fs);
    const stat = fs.stat.bind(fs);
    let armed = false;
    // Another start breaks the stale lock before this one gets the break file...
    vi.spyOn(fs, "open")
      .mockImplementationOnce(open)
      .mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
        await fs.rm(file);
        armed = true;
        return open(...args);
      });
    // ...and takes it right after this one found it gone. The look reads the text and the file time
    // at the same time, and either one that finds the file gone settles it: both wait for the take,
    // so that it is complete before this start tries again (#274). Waiting in `readFile` alone let
    // a missing file time settle the look first, and on a slow runner this start then took the lock
    // before the other start had written it.
    let taken: Promise<void> | undefined;
    const takeOnce = async (target: unknown): Promise<void> => {
      if (armed && target === file) {
        taken ??= fs.writeFile(file, fresh);
        await taken;
      }
    };
    vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      try {
        return await readFile(...args);
      } finally {
        await takeOnce(args[0]);
      }
    });
    vi.spyOn(fs, "stat").mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
      try {
        return await stat(...args);
      } finally {
        await takeOnce(args[0]);
      }
    });
    expect(await lockPrivateFile(file)).toBeUndefined();
    expect(await readFile(file, "utf8")).toBe(fresh);
    expect(await fs.readdir(path.dirname(file))).toEqual(["api.json.lock"]);
  });

  it("counts the lock as held after three tries", async () => {
    await writeLock(lockOf({ pid: DEAD_PID }));
    const rm = fs.rm.bind(fs);
    // The stale lock never goes away.
    const spy = vi
      .spyOn(fs, "rm")
      .mockImplementation(async (target, options) => (target === file ? undefined : rm(target, options)));
    expect(await lockPrivateFile(file)).toBeUndefined();
    expect(spy.mock.calls.filter(([target]) => target === file)).toHaveLength(3);
  });

  it("tries again while Windows refuses to create a lock that is being removed", async () => {
    const open = fs.open.bind(fs);
    const spy = vi.spyOn(fs, "open").mockRejectedValueOnce(failure("EPERM"));
    spy.mockImplementation(open);
    const lock = await lockPrivateFile(file);
    expect(lock).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(2);
    await lock?.release();
  });

  it("rejects with the Node error when the lock cannot be created, read or removed", async () => {
    await fs.writeFile(path.join(root, "file"), "");
    await expect(lockPrivateFile(path.join(root, "file", "api.json.lock"))).rejects.toMatchObject({
      code: expect.stringMatching(/^(EEXIST|ENOTDIR)$/) as unknown,
    });

    vi.spyOn(fs, "open").mockRejectedValueOnce(failure("EIO"));
    await expect(lockPrivateFile(file)).rejects.toThrow("EIO");

    await writeLock(lockOf({ pid: DEAD_PID }));
    vi.spyOn(fs, "stat").mockRejectedValueOnce(failure("EIO"));
    await expect(lockPrivateFile(file)).rejects.toThrow("EIO");

    const rm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation(async (target, options) => {
      if (target === file) {
        throw failure("EIO");
      }
      await rm(target, options);
    });
    await expect(lockPrivateFile(file)).rejects.toThrow("EIO");
    // The breaker gave its turn back.
    expect(await fs.readdir(path.dirname(file))).toEqual(["api.json.lock"]);
  });

  it("leaves no lock behind when it cannot be written", async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      vi.spyOn(handle, "writeFile").mockRejectedValue(failure("ENOSPC"));
      return handle;
    });
    await expect(lockPrivateFile(file)).rejects.toThrow("ENOSPC");
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("closes the handle quietly when writing and closing both fail", async () => {
    const open = fs.open.bind(fs);
    let real: fs.FileHandle | undefined;
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      real = await open(...args);
      const handle = real;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "writeFile").mockRejectedValue(failure("ENOSPC"));
      vi.spyOn(handle, "close").mockImplementation(async () => {
        await close();
        throw failure("EIO");
      });
      return handle;
    });
    vi.spyOn(fs, "rm").mockRejectedValue(failure("EBUSY"));
    await expect(lockPrivateFile(file)).rejects.toThrow("ENOSPC");
    expect(real).toBeDefined();
  });

  it("gives back only its own lock, and never rejects on release", async () => {
    const lock = await lockPrivateFile(file);
    await fs.writeFile(file, "another lock");
    await lock?.release();
    expect(await fs.readFile(file, "utf8")).toBe("another lock");

    await fs.rm(file);
    const stuck = await lockPrivateFile(file);
    vi.spyOn(fs, "rm").mockRejectedValue(failure("EIO"));
    await expect(stuck?.release()).resolves.toBeUndefined();
  });
});
