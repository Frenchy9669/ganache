import { fork } from "child_process";
import createInstanceName from "./process-name";
import envPaths from "env-paths";
import psList from "@trufflesuite/ps-list";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync
} from "fs";
import path from "path";
import { StartArgs } from "./types";
import { FlavorName } from "@ganache/flavors";

export type DetachedInstance = {
  instanceName: string;
  pid: number;
  startTime: number;
  host: string;
  port: number;
  flavor: FlavorName;
  cmd: string;
  version: string;
};

const dataPath = envPaths(`Ganache/instances`).data;
if (!existsSync(dataPath)) mkdirSync(dataPath, { recursive: true });

const READY_MESSAGE = "ready";

const START_ERROR = "An error ocurred spawning a detached instance of Ganache:";

/**
 * Notify that the detached instance has started and is ready to receive requests.
 */
export function notifyDetachedInstanceReady() {
  // in "detach" mode, the parent will wait until the "ready" message is
  // received before disconnecting from the child process.
  process.send(READY_MESSAGE);
}

/**
 * Attempt to find and remove the instance file for a detached instance.
 * @param  {number} pid the pid of the detached instance
 * @returns boolean indicating whether the instance file was cleaned up successfully
 */
export function removeDetachedInstanceFile(pid: number): boolean {
  const instanceFilename = `${dataPath}/${pid}`;
  if (existsSync(instanceFilename)) {
    rmSync(instanceFilename);
    return true;
  }
  return false;
}

/**
 * Attempts to stop a detached instance with the specified instance name by
 * sending a SIGTERM signal. Returns a boolean indicating whether the process
 * was found. If the PID is identified, but the process is not found, any
 * corresponding instance file will be removed.
 *
 * Note: This does not guarantee that the instance actually stops.
 * @param  {string} instanceName
 * @returns boolean indicating whether the instance was found.
 */
export async function stopDetachedInstance(
  instanceName: string
): Promise<boolean> {
  const instance = await findDetachedInstanceByName(instanceName);
  if (instance !== undefined) {
    try {
      process.kill(instance.pid, "SIGTERM");
    } catch (err) {
      // process.kill throws if the process was not found (or was a group process in Windows)
      return false;
    } finally {
      removeDetachedInstanceFile(instance.pid);
    }
    return true;
  }
  return false;
}

/**
 * Start an instance of Ganache in detached mode.
 * @param  {string[]} argv arguments to be passed to the new instance.
 * @returns {Promise<DetachedInstance>} resolves to the DetachedInstance once it
 * is started and ready to receive requests.
 */
export async function startDetachedInstance(
  module: string,
  args: StartArgs<FlavorName>,
  version: string
): Promise<DetachedInstance> {
  const flavor = args.flavor;
  const childArgs = createFlatChildArgs(args);
  const child = fork(module, childArgs, {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    detached: true
  });
  const cmd = (await psList()).find(p => p.pid === child.pid).cmd;

  // Any messages output to stderr by the child process (before the `ready`
  // event is emitted) will be streamed to stderr on the parent.
  child.stderr.pipe(process.stderr);

  const instances = await getDetachedInstances();
  const instanceNames = instances.map(instance => instance.instanceName);

  let instanceName: string;
  do {
    instanceName = createInstanceName();
  } while (instanceNames.indexOf(instanceName) !== -1);

  await new Promise<void>((resolve, reject) => {
    child.on("message", message => {
      if (message === READY_MESSAGE) {
        resolve();
      }
    });

    child.on("error", err => {
      // This only happens if there's an error starting the child process, not
      // if Ganache throws within the child process.
      console.error(`${START_ERROR}\n${err.message}`);
      process.exitCode = 1;
      reject(err);
    });

    child.on("exit", (code: number) => {
      // This shouldn't happen, so ensure that we surface a non-zero exit code.
      process.exitCode = code === 0 ? 1 : code;
      reject(
        new Error(
          `${START_ERROR}\nThe detached instance exited with error code: ${code}`
        )
      );
    });
  });

  // destroy the ReadableStream exposed by the child process, to allow the
  // parent to exit gracefully.
  child.stderr.destroy();
  child.unref();
  child.disconnect();

  const instance: DetachedInstance = {
    startTime: Date.now(),
    pid: child.pid,
    instanceName,
    host: args.server.host,
    port: args.server.port,
    flavor,
    cmd,
    version
  };

  const instanceFilename = `${dataPath}/${instance.pid}`;

  writeFileSync(instanceFilename, JSON.stringify(instance));

  return instance;
}

/**
 * Fetch all instance of Ganache running in detached mode. Cleans up any
 * instance files for processes that are no longer running.
 * @returns {Promise<DetachedInstance[]>} resolves with an array of instances
 */
export async function getDetachedInstances(): Promise<DetachedInstance[]> {
  const files = readdirSync(dataPath);
  const instances: DetachedInstance[] = [];
  const processes = await psList();

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const pid = parseInt(filename);

    const foundProcess = processes.find(p => p.pid === pid);

    let shouldRemoveFile = false;

    if (foundProcess !== undefined) {
      const filepath = path.join(dataPath, filename);
      try {
        const content = readFileSync(filepath, { encoding: "utf8" });
        const instance = JSON.parse(content) as DetachedInstance;
        // if the cmd does not match the instance, the process has been killed,
        // and another application has taken the pid
        if (foundProcess.cmd !== instance.cmd) {
          shouldRemoveFile = true;
        } else {
          instances.push(instance);
        }
      } catch (err) {
        console.error(
          `Instance data corrupted. Process has been killed (PID ${pid})`
        );
        process.kill(pid, "SIGTERM");
        shouldRemoveFile = true;
      }
    } else {
      shouldRemoveFile = true;
    }
    if (shouldRemoveFile) removeDetachedInstanceFile(pid);
  }

  instances.sort((a, b) => b.startTime - a.startTime);

  return instances;
}

async function findDetachedInstanceByName(
  instanceName: string
): Promise<DetachedInstance | undefined> {
  const instances = await getDetachedInstances();

  for (let i = 0; i < instances.length; i++) {
    if (instances[i].instanceName === instanceName) {
      return instances[i];
    }
  }
}

/**
 * Flattens parsed and namespaced args into an array of arguments to be passed
 * to a child process. This handles "special" arguments, such as "action",
 * "flavor" and "--detach".
 * @param  {object} args to be flattened
 * @returns string[] of flattened arguments
 */
export function createFlatChildArgs(args: object): string[] {
  const flattenedArgs = [];

  function flatten(namespace: string, args: object) {
    const prefix = namespace === null ? "" : `${namespace}.`;
    for (const key in args) {
      const value = args[key];
      if (key === "flavor") {
        // flavor is input as a command, e.g. `ganache filecoin`, so we just
        // unshift it to the start of the array
        flattenedArgs.unshift(value);
        // action doesn't need to be specified in the returned arguments array
      } else if (key !== "action") {
        if (typeof value === "object") {
          flatten(`${prefix}${key}`, value);
        } else {
          flattenedArgs.push(`--${prefix}${key}=${value}`);
        }
      }
    }
  }

  flatten(null, args);

  return flattenedArgs;
}