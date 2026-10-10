import { BadRequestException } from '@nestjs/common';
import {
  maskPersistedParameters,
  parseQueueId,
  redactJenkinsLog,
  stripJenkinsConsoleNotes,
  validateJenkinsParameters,
} from './cicd-run.policy';

describe('cicd run policy', () => {
  it('parses Jenkins queue location', () => {
    expect(parseQueueId('https://jenkins/queue/item/42/')).toBe(42);
    expect(parseQueueId('/queue/item/7')).toBe(7);
    expect(parseQueueId('/job/demo/1')).toBeNull();
  });

  it('normalizes declared parameters and defaults', () => {
    expect(
      validateJenkinsParameters(
        [
          {
            name: 'BRANCH',
            type: 'StringParameterDefinition',
            default: 'main',
          },
          {
            name: 'DRY_RUN',
            type: 'BooleanParameterDefinition',
            default: false,
          },
        ],
        { BRANCH: 'release', DRY_RUN: true },
      ),
    ).toEqual({ BRANCH: 'release', DRY_RUN: 'true' });
  });

  it('rejects unknown and invalid choice parameters', () => {
    expect(() => validateJenkinsParameters([], { TOKEN: 'secret' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      validateJenkinsParameters(
        [
          {
            name: 'ENV',
            type: 'ChoiceParameterDefinition',
            default: 'dev',
            choices: ['dev'],
          },
        ],
        { ENV: 'prod' },
      ),
    ).toThrow(BadRequestException);
  });

  it('masks secret parameters and common console secrets', () => {
    expect(
      maskPersistedParameters(
        [
          {
            name: 'API_TOKEN',
            type: 'PasswordParameterDefinition',
            default: '',
          },
        ],
        { API_TOKEN: 'value', BRANCH: 'main' },
      ),
    ).toEqual({ API_TOKEN: '******', BRANCH: 'main' });
    expect(redactJenkinsLog('token=abc123 AKIA1234567890ABCDEF')).toBe(
      'token=[REDACTED] [REDACTED_AWS_ACCESS_KEY]',
    );
  });

  it('removes Jenkins ConsoleNote metadata while preserving visible output', () => {
    const note =
      '\u001b[8mha:////4HdA2NAblf61PIwlDIGRZ7Iw+fLI7B1KM97vuJ74/VHlAAAApB+LCAAAAAAAAP8=\u001b[0m';
    expect(stripJenkinsConsoleNotes(`${note}[Pipeline] // stage\n`)).toBe(
      '[Pipeline] // stage\n',
    );
  });

  it('keeps ordinary ANSI color sequences while redacting secrets', () => {
    expect(redactJenkinsLog('\u001b[32mok\u001b[0m token=abc123')).toBe(
      '\u001b[32mok\u001b[0m token=[REDACTED]',
    );
  });
});
