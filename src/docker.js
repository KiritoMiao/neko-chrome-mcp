import { spawn, spawnSync } from 'node:child_process';

export function resolveDockerCommand() {
  if (commandSucceeds(['docker', 'info'])) {
    return ['docker'];
  }
  if (commandSucceeds(['sudo', '-n', 'docker', 'info'])) {
    return ['sudo', 'docker'];
  }
  throw new Error('Docker is not available. Re-login for docker group membership or configure passwordless sudo for docker.');
}

export function runDocker(dockerCommand, args, options = {}) {
  const result = spawnSync(dockerCommand[0], [...dockerCommand.slice(1), ...args], {
    encoding: 'utf8',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `docker ${args.join(' ')} failed with status ${result.status}`);
  }

  return result.stdout ?? '';
}

export function spawnDocker(dockerCommand, args, options = {}) {
  return spawn(dockerCommand[0], [...dockerCommand.slice(1), ...args], {
    stdio: 'inherit',
    ...options
  });
}

export function containerRunning(dockerCommand, name) {
  const result = spawnSync(dockerCommand[0], [
    ...dockerCommand.slice(1),
    'inspect',
    '-f',
    '{{.State.Running}}',
    name
  ], {
    encoding: 'utf8'
  });

  return result.status === 0 && result.stdout.trim() === 'true';
}

export function containerExists(dockerCommand, name) {
  const result = spawnSync(dockerCommand[0], [
    ...dockerCommand.slice(1),
    'inspect',
    name
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore']
  });

  return result.status === 0;
}

function commandSucceeds(command) {
  const result = spawnSync(command[0], command.slice(1), {
    stdio: ['ignore', 'ignore', 'ignore']
  });

  return result.status === 0;
}
