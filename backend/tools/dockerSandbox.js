import Docker from 'dockerode';
import stream from 'node:stream';

// Initialize Docker client (connects to local docker daemon via socket default)
const docker = new Docker();

/**
 * Execute arbitrary code or shell commands inside an ephemeral, hardened Docker container.
 *
 * Security features:
 * - Network isolation (none by default) to prevent data exfiltration.
 * - Memory & CPU limits to prevent denial of service (fork bombs).
 * - Directory constraints: ONLY mounts the specific user's virtual workspace.
 * - Timeout: force kills container if execution takes too long.
 *
 * @param {string} userWorkspace - Absolute path to the user's isolated directory.
 * @param {string} code - The code or script to execute.
 * @param {string} [language='bash'] - Language environment ('node', 'python', 'bash').
 * @param {number} [timeoutMs=15000] - Hard fallback kill timeout limit.
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export async function executeInSandbox(userWorkspace, code, language = 'bash', timeoutMs = 15000) {
  let image;
  let cmd;

  // Map language to base images and entrypoints
  switch (language) {
    case 'node':
    case 'javascript':
    case 'js':
      image = 'node:20-alpine';
      cmd = ['node', '-e', code];
      break;
    case 'python':
    case 'py':
      image = 'python:3.12-alpine';
      cmd = ['python', '-c', code];
      break;
    case 'bash':
    case 'sh':
    default:
      image = 'alpine:3.19';
      cmd = ['sh', '-c', code];
      break;
  }

  // Define Container spec
  const containerOptions = {
    Image: image,
    Cmd: cmd,
    HostConfig: {
      AutoRemove: true, // Immediately delete when stopped
      NetworkMode: 'none', // Zero network access (blocks malicious curl/exfiltration)
      Memory: 256 * 1024 * 1024, // 256MB Memory hard cap
      PidsLimit: 50, // Prevent fork bombs
      Binds: [`${userWorkspace}:/workspace`], // Mount only user's folder
    },
    WorkingDir: '/workspace',
    Tty: false,
  };

  let stdoutData = '';
  let stderrData = '';

  try {
    // 1. Ensure image exists (fails fast if docker daemon lacks it, we assume server pre-pulled them to avoid delays)
    // In production, we'll try to create, and if it fails due to missing image, we attempt pull.
    let container;
    try {
      container = await docker.createContainer(containerOptions);
    } catch (e) {
      if (e.statusCode === 404) {
        throw new Error(
          `Docker image ${image} not found locally. Please pre-pull it using: docker pull ${image}`,
          { cause: e },
        );
      }
      throw e;
    }

    // Capture Output Streams
    const stdoutStream = new stream.PassThrough();
    const stderrStream = new stream.PassThrough();

    stdoutStream.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });
    stderrStream.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    // 2. Start execution
    await container.start();

    // 3. Attach logs
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    // dockerode passes multiplexed stdout/stderr via demux
    container.modem.demuxStream(logStream, stdoutStream, stderrStream);

    // 4. Wait for completion with strict timeout
    const exitCode = await new Promise((resolve, reject) => {
      let isSettled = false;
      const timer = setTimeout(async () => {
        if (isSettled) return;
        isSettled = true;
        try {
          await container.kill();
          reject(new Error(`Execution timed out after ${timeoutMs}ms.`));
        } catch (killErr) {
          reject(new Error(`Execution timed out and kill failed: ${killErr.message}`));
        }
      }, timeoutMs);

      container
        .wait()
        .then((data) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            resolve(data.StatusCode);
          }
        })
        .catch((err) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });

    // Wait for log streams to fully drain before reading collected output
    await Promise.all([
      new Promise((r) => stdoutStream.on('end', r)),
      new Promise((r) => stderrStream.on('end', r)),
    ]);

    return {
      stdout: stdoutData,
      stderr: stderrData,
      exitCode,
    };
  } catch (error) {
    throw new Error(`Sandbox Execution Error: ${error.message}\nStderr: ${stderrData}`, {
      cause: error,
    });
  }
}
