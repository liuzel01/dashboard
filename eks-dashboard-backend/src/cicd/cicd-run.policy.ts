import { BadRequestException } from '@nestjs/common';
import type { JenkinsParameter } from './cicd-catalog.policy';

export const TERMINAL_CICD_STATUSES = [
  'SUCCESS',
  'FAILURE',
  'ABORTED',
  'CANCELLED',
] as const;

export const parseQueueId = (location?: string | null) => {
  const matched = String(location || '').match(/\/queue\/item\/(\d+)\/?/);
  return matched ? Number(matched[1]) : null;
};

const booleanValue = (value: unknown, name: string) => {
  if (value === true || value === 'true') return 'true';
  if (value === false || value === 'false') return 'false';
  throw new BadRequestException(`参数 ${name} 必须是布尔值`);
};

export const validateJenkinsParameters = (
  definitions: JenkinsParameter[],
  input: Record<string, unknown>,
) => {
  const allowed = new Map(definitions.map((item) => [item.name, item]));
  const unknown = Object.keys(input).filter((name) => !allowed.has(name));
  if (unknown.length) {
    throw new BadRequestException(
      `存在 Jenkins 未声明的参数：${unknown.join(', ')}`,
    );
  }
  const normalized: Record<string, string> = {};
  for (const definition of definitions) {
    const raw = Object.prototype.hasOwnProperty.call(input, definition.name)
      ? input[definition.name]
      : definition.default;
    if (String(definition.type).includes('Boolean')) {
      normalized[definition.name] = booleanValue(raw ?? false, definition.name);
      continue;
    }
    if (raw != null && !['string', 'number', 'boolean'].includes(typeof raw)) {
      throw new BadRequestException(`参数 ${definition.name} 必须是标量值`);
    }
    const value = raw == null ? '' : String(raw as string | number | boolean);
    if (value.length > 2_000) {
      throw new BadRequestException(
        `参数 ${definition.name} 长度不能超过 2000`,
      );
    }
    if (definition.choices?.length && !definition.choices.includes(value)) {
      throw new BadRequestException(
        `参数 ${definition.name} 不在 Jenkins 选项范围内`,
      );
    }
    normalized[definition.name] = value;
  }
  return normalized;
};

export const maskPersistedParameters = (
  definitions: JenkinsParameter[],
  values: Record<string, string>,
) => {
  const secretNames = new Set(
    definitions
      .filter(
        (item) =>
          item.type.includes('Password') ||
          /(password|passwd|token|secret|credential|access.?key)/i.test(
            item.name,
          ),
      )
      .map((item) => item.name),
  );
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      secretNames.has(name) && value ? '******' : value,
    ]),
  );
};

const JENKINS_CONSOLE_NOTE = /\u001b\[8mha:[A-Za-z0-9+/_=-]+\u001b\[0m/g;

export const stripJenkinsConsoleNotes = (value: string) =>
  value.replace(JENKINS_CONSOLE_NOTE, '');

export const redactJenkinsLog = (value: string) =>
  stripJenkinsConsoleNotes(value)
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(
      /((?:password|passwd|token|secret|credential|access.?key)\s*[=:]\s*)([^\s"']+)/gi,
      '$1[REDACTED]',
    );
