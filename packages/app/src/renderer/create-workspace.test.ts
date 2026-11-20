// The order of "Create workspace" of the start buffer (SR-225 AK4–AK6): main's answer, the open of the folder and
// its status may come in any order; the window asks the name, or names the existing workspace, once all are there.
import { describe, expect, it, vi } from "vitest";
import type { CreateFolderAnswer } from "../shared/protocol.js";
import type { CreateRunnerDeps } from "./create-workspace.js";
import { CREATE_REFUSED, createRunner, openedExisting } from "./create-workspace.js";

const setup = (catalogRead: () => Promise<void> | undefined = () => undefined) => {
  const answers: ((answer: CreateFolderAnswer) => void)[] = [];
  const deps = {
    choose: vi.fn(
      () =>
        new Promise<CreateFolderAnswer>((resolve) => {
          answers.push(resolve);
        }),
    ),
    echo: vi.fn<(message: string) => void>(),
    catalogRead: vi.fn(catalogRead),
    askName: vi.fn<(initial: string) => void>(),
  } satisfies CreateRunnerDeps;
  const runner = createRunner(deps);
  const answer = async (value: CreateFolderAnswer, at = answers.length - 1): Promise<void> => {
    answers[at]?.(value);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return { deps, runner, answer, settled };
};

describe("Create workspace of the start buffer", () => {
  it("asks the name once main answered, the folder opened and its status arrived, in either order", async () => {
    const first = setup();
    first.runner.start();
    // A second choice while one runs does nothing.
    first.runner.start();
    expect(first.deps.choose).toHaveBeenCalledOnce();
    await first.answer({ outcome: "folder", name: "Station", opening: true });
    // A status before the open is not the folder's.
    first.runner.shown(undefined);
    first.runner.changed("written");
    first.runner.changed("opened");
    expect(first.deps.askName).not.toHaveBeenCalled();
    first.runner.shown(undefined);
    await first.settled();
    expect(first.deps.askName).toHaveBeenCalledExactlyOnceWith("Station");
    // The run is over: later statuses ask nothing.
    first.runner.changed("opened");
    first.runner.shown(undefined);
    await first.settled();
    expect(first.deps.askName).toHaveBeenCalledOnce();

    const second = setup();
    second.runner.start();
    second.runner.changed("opened");
    second.runner.shown(undefined);
    // A second status before the answer does not take the place of the first.
    second.runner.shown("Other");
    await second.answer({ outcome: "folder", name: "Buoy", opening: true });
    expect(second.deps.askName).toHaveBeenCalledExactlyOnceWith("Buoy");
  });

  it("asks the name once the catalog is read, and not when its read failed", async () => {
    let read: () => void = () => undefined;
    const reading = setup(
      () =>
        new Promise<void>((resolve) => {
          read = resolve;
        }),
    );
    reading.runner.start();
    await reading.answer({ outcome: "folder", name: "Station", opening: false });
    expect(reading.deps.askName).not.toHaveBeenCalled();
    read();
    await reading.settled();
    expect(reading.deps.askName).toHaveBeenCalledExactlyOnceWith("Station");

    const failed = setup(() => Promise.reject(new Error("gone")));
    failed.runner.start();
    await failed.answer({ outcome: "folder", name: "Station", opening: false });
    expect(failed.deps.askName).not.toHaveBeenCalled();
  });

  it("names an existing workspace that opened, and says nothing when it did not open as one", async () => {
    const opened = setup();
    opened.runner.start();
    await opened.answer({ outcome: "existing" });
    opened.runner.changed("opened");
    opened.runner.shown("Weather station");
    expect(opened.deps.echo).toHaveBeenCalledExactlyOnceWith(openedExisting("Weather station"));

    const faulty = setup();
    faulty.runner.start();
    await faulty.answer({ outcome: "existing" });
    faulty.runner.changed("opened");
    faulty.runner.shown(undefined);
    expect(faulty.deps.echo).not.toHaveBeenCalled();

    // A folder that has a workspace by the time its status arrives asks no name.
    const meanwhile = setup();
    meanwhile.runner.start();
    await meanwhile.answer({ outcome: "folder", name: "Station", opening: true });
    meanwhile.runner.changed("opened");
    meanwhile.runner.shown("Station");
    await meanwhile.settled();
    expect(meanwhile.deps.askName).not.toHaveBeenCalled();
  });

  it("ends with nothing on a cancel, a refusal, a stopped core process or a second open", async () => {
    const { deps, runner, answer } = setup();
    runner.start();
    await answer({ outcome: "nothing" });
    expect(deps.echo).not.toHaveBeenCalled();
    runner.start();
    await answer({ outcome: "refused" });
    expect(deps.echo).toHaveBeenCalledExactlyOnceWith(CREATE_REFUSED);
    // The core process stopped: the answer that comes later belongs to no run.
    runner.start();
    runner.changed("stopped");
    await answer({ outcome: "folder", name: "Station", opening: true });
    runner.changed("opened");
    runner.shown(undefined);
    // Another folder opened after the run's own.
    runner.start();
    runner.changed("opened");
    runner.changed("opened");
    await answer({ outcome: "folder", name: "Station", opening: true });
    runner.shown(undefined);
    expect(deps.askName).not.toHaveBeenCalled();
    expect(deps.echo).toHaveBeenCalledOnce();
    expect(deps.choose).toHaveBeenCalledTimes(4);
  });
});
