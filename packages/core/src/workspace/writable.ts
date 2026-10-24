// Whether a repository folder can be written (SR-018 AK2). Rights to change the metamodel are
// enforced by the Git server per repository (D-016, D-024): the usual read-only metamodel
// repository is a writable local clone whose pushes are refused, and LogReq never pushes (D-036).
// Beyond that, the local folder itself may be read-only: a read-only file system or a checkout
// without write permission. That is normal: it never makes the workspace read-only, and every write
// into such a folder is refused by the files block with `file.read-only`. This only asks the
// operating system about the repository folder itself; nothing is written.
import { constants } from "node:fs";
import fs from "node:fs/promises";

/**
 * Whether this process may create files in `folder` (`access(W_OK)`): false on a read-only file
 * system, without write permission, or when the folder cannot be checked at all (e.g. it vanished,
 * ENOENT). Asked on every call, since permissions change while a workspace is open.
 *
 * Undefined (unknown) on Windows: there `access` never reports a folder as read-only (it checks
 * neither ACLs nor the read-only attribute of folders), so it cannot tell. The write itself is
 * still refused by the operating system and reported as `file.read-only`.
 */
export const isWritableFolder = async (
  folder: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean | undefined> => {
  if (platform === "win32") {
    return undefined;
  }
  return fs.access(folder, constants.W_OK).then(
    () => true,
    () => false,
  );
};
